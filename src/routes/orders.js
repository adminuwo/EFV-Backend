const express = require('express');
const router = express.Router();
const { Order, Product, User, DigitalLibrary, Coupon } = require('../models');
const adminAuth = require('../middleware/adminAuth');
const { protect } = require('../middleware/auth');
const { createCashfreeOrder, verifyCashfreePayment } = require('../utils/cashfree');
const { processPartnerSale } = require('../utils/partnerUtils');
const path = require('path');


// Get current user's orders
router.get('/my-orders', protect, async (req, res) => {
    try {
        const query = {
            $or: [
                { userId: req.user._id },
                { "customer.email": new RegExp('^' + req.user.email + '$', 'i') }
            ]
        };
        const orders = await Order.find(query);
        const logMsg = `[${new Date().toISOString()}] User ${req.user.email} requested orders. Found: ${orders.length}\n`;
        require('fs').appendFileSync(path.join(__dirname, '..', 'data', 'orders_debug.log'), logMsg);

        // Sort manually
        const sortedOrders = orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json(sortedOrders);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders' });
    }
});

// Config for Frontend (Public Keys)
router.get('/config', (req, res) => {
    res.json({
        cashfreeMode: process.env.CASHFREE_MODE || 'sandbox'
    });
});

// Get all orders (Admin Only)
router.get('/', adminAuth, async (req, res) => {
    try {
        const orders = await Order.find().sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders' });
    }
});

// Place new order (Public)
router.post('/', async (req, res) => {
    try {
        const { customer, items, paymentMethod, couponCode } = req.body;

        if (!customer || !items || items.length === 0) {
            return res.status(400).json({ message: 'Invalid order data' });
        }

        let totalAmount = 0;
        const orderItems = [];

        for (const item of items) {
            const product = await Product.findById(item.productId);
            if (!product) continue;

            // Check stock for physical items
            if (product.type === 'HARDCOVER' || product.type === 'PAPERBACK') {
                if (product.stock < item.quantity) {
                    return res.status(400).json({ message: `Insufficient stock for ${product.title}` });
                }
                // Decrease stock
                await Product.findByIdAndUpdate(product._id, { $inc: { stock: -item.quantity } });
            }

            const price = product.price * (1 - (product.discount || 0) / 100);
            totalAmount += price * item.quantity;

            orderItems.push({
                productId: product._id,
                title: product.title,
                type: product.type,
                price: price,
                quantity: item.quantity
            });
        }

        // Handle Coupon logic
        let discountAmount = 0;
        let partnerRef = null;
        let appliedCouponCode = '';

        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
            if (coupon) {
                // Validate coupon (basic check, more thorough check should be done on frontend too)
                const isExpired = coupon.expiryDate && new Date(coupon.expiryDate) < new Date();
                const isUnderMin = totalAmount < (coupon.minOrder || 0);
                const isLimitReached = coupon.usedCount >= coupon.usageLimit;

                if (!isExpired && !isUnderMin && !isLimitReached) {
                    if (coupon.type === 'Percentage') {
                        discountAmount = (totalAmount * coupon.value) / 100;
                    } else {
                        discountAmount = coupon.value;
                    }

                    // Cap discount to total amount
                    discountAmount = Math.min(discountAmount, totalAmount);
                    appliedCouponCode = coupon.code;

                    // Update used count
                    coupon.usedCount += 1;
                    await coupon.save();

                    // If it's a partner coupon, associate with the order
                    if (coupon.isPartnerCoupon && coupon.partnerId) {
                        const commissionAmount = (totalAmount * (coupon.commissionPercent || 0)) / 100;
                        partnerRef = {
                            partnerId: coupon.partnerId.toString(),
                            partnerName: coupon.partnerName || 'Unknown Partner',
                            couponCode: coupon.code,
                            commissionPercent: coupon.commissionPercent,
                            commissionAmount: Math.round(commissionAmount),
                            commissionPaid: false
                        };
                    }
                }
            }
        }

        const finalAmount = Math.max(0, totalAmount - discountAmount);

        // Link to user if possible (even if guest has account)
        let userId = null;
        try {
            const potentialUser = await User.findOne({ email: customer.email });
            if (potentialUser) {
                userId = potentialUser._id;
            }
        } catch (e) { }

        const newOrder = await Order.create({
            orderId: 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000),
            userId: userId,
            customer,
            items: orderItems,
            totalAmount: Math.round(finalAmount),
            discountAmount: Math.round(discountAmount),
            couponCode: appliedCouponCode,
            partnerRef: partnerRef,
            paymentMethod: paymentMethod || 'COD',
            timeline: [{ status: 'Pending', note: 'Order placed successfully' }]
        });

        // 🔔 Add Purchase Notification (Private)
        if (userId) {
            try {
                await User.findByIdAndUpdate(userId, (u) => {
                    if (!u.notifications) u.notifications = [];
                    u.notifications.unshift({
                        _id: 'purchase-cod-' + Date.now(),
                        title: 'Order Placed! 📦',
                        message: `Wait for confirmation! Your order ${newOrder.orderId} (COD) has been placed.`,
                        type: 'Order',
                        link: 'profile.html?tab=orders',
                        isRead: false,
                        createdAt: new Date().toISOString()
                    });
                    u.updatedAt = new Date().toISOString();
                    return u;
                });
            } catch (noteErr) {
                console.error('COD notification error:', noteErr);
            }
        }

        // 💰 Process Partner Sale (Audit record & Partner Totals)
        if (newOrder.partnerRef) {
            await processPartnerSale(newOrder, newOrder.partnerRef);
        }

        res.status(201).json(newOrder);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error placing order' });
    }
});



// Create Cashfree Order
router.post('/cashfree', protect, async (req, res) => {
    try {
        const { amount, customerName, customerPhone, customerEmail } = req.body;
        if (!amount) return res.status(400).json({ message: 'Amount is required' });

        const orderId = `EFV-CF-${Date.now()}`;
        const roundedAmount = Number(amount).toFixed(2);

        const cfOrder = await createCashfreeOrder({
            orderId: orderId,
            amount: Number(roundedAmount),
            customerId: req.user._id.toString(),
            customerName: customerName || req.user.name,
            customerPhone: customerPhone || req.user.phone || '0000000000',
            customerEmail: customerEmail || req.user.email
        });

        res.json(cfOrder);
    } catch (error) {
        console.error('Cashfree API Error:', error);
        res.status(500).json({
            message: 'Failed to create Cashfree order',
            error: error.response ? error.response.data : error.message
        });
    }
});

// Verify Cashfree Payment
router.post('/verify-cashfree', protect, async (req, res) => {
    try {
        const { order_id, checkoutData, customer: directCustomer, items: directItems, couponCode } = req.body;

        if (!order_id) return res.status(400).json({ message: 'Order ID is required' });

        // 1. Verify Payment with Cashfree
        const payments = await verifyCashfreePayment(order_id);
        const successfulPayment = payments.find(p => p.payment_status === 'SUCCESS');

        if (!successfulPayment) {
            console.warn(`⚠️ Cashfree Payment Verification Failed for Order: ${order_id}`);
            return res.status(400).json({ message: 'Payment not successful or not found' });
        }

        console.log(`✅ Cashfree Payment Verified for Order: ${order_id}. Initializing fulfillment...`);
        console.log('📦 Received Verification Data:', JSON.stringify({ checkoutData, directCustomer, items: directItems, couponCode }, null, 2));

        // 2. Fulfill Order (Reuse logic from /verify)
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        let finalItems = [];
        let address = null;

        if (checkoutData) {
            finalItems = checkoutData.items || [];
            if (checkoutData.selectedAddressId) {
                address = user.savedAddresses.find(a => (a._id || a.id || '').toString() === checkoutData.selectedAddressId.toString());
            } else if (checkoutData.address) {
                address = checkoutData.address;
            }
        } else {
            finalItems = directItems || [];
            if (directCustomer) {
                address = {
                    fullName: directCustomer.name,
                    email: directCustomer.email,
                    phone: directCustomer.phone || user.phone || '0000000000',
                    house: directCustomer.address || '',
                    city: directCustomer.city || 'Unknown',
                    state: directCustomer.state || '',
                    pincode: directCustomer.pincode || directCustomer.zip || '000000',
                    country: directCustomer.country || 'India'
                };
            }
        }

        if (!address) return res.status(400).json({ message: 'Shipping address missing' });
        if (!finalItems || finalItems.length === 0) return res.status(400).json({ message: 'No items in order' });

        let totalAmount = 0;
        const orderItems = [];

        for (const item of finalItems) {
            const product = await Product.findById(item.id || item.productId);
            if (!product) continue;

            const sellingPrice = product.price * (1 - (product.discount || 0) / 100);
            totalAmount += sellingPrice * item.quantity;
            orderItems.push({
                productId: product._id,
                title: product.title,
                type: product.type,
                price: sellingPrice,
                quantity: item.quantity
            });
        }

        if (orderItems.length === 0) return res.status(400).json({ message: 'No valid products found in order' });

        // Apply Coupon logic in verification as well (if passed from frontend)
        let discountAmount = 0;
        let partnerRef = null;
        let appliedCouponCode = '';

        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
            if (coupon) {
                // Validate coupon
                const isExpired = coupon.expiryDate && new Date(coupon.expiryDate) < new Date();
                const isUnderMin = totalAmount < (coupon.minOrder || 0);
                const isLimitReached = coupon.usedCount >= coupon.usageLimit;

                if (!isExpired && !isUnderMin && !isLimitReached) {
                    if (coupon.type === 'Percentage') {
                        discountAmount = (totalAmount * coupon.value) / 100;
                    } else {
                        discountAmount = coupon.value;
                    }

                    discountAmount = Math.min(discountAmount, totalAmount);
                    appliedCouponCode = coupon.code;

                    // Permanent usage record (increment now since payment is verified)
                    coupon.usedCount += 1;
                    await coupon.save();

                    if (coupon.isPartnerCoupon && coupon.partnerId) {
                        const commissionAmount = (totalAmount * (coupon.commissionPercent || 0)) / 100;
                        partnerRef = {
                            partnerId: coupon.partnerId.toString(),
                            partnerName: coupon.partnerName || 'Unknown Partner',
                            couponCode: coupon.code,
                            commissionPercent: coupon.commissionPercent,
                            commissionAmount: Math.round(commissionAmount),
                            commissionPaid: false
                        };
                    }
                }
            }
        }

        const finalPayable = Math.round(totalAmount - discountAmount);

        // Determine if this is a purely digital order
        const isPurelyDigital = orderItems.every(i => i.type === 'EBOOK' || i.type === 'AUDIOBOOK');

        const newOrder = await Order.create({
            orderId: 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000),
            userId: user._id,
            customer: {
                name: address.fullName || user.name,
                email: address.email || user.email,
                phone: address.phone || user.phone || '0000000000',
                address: address,
                city: address.city || '',
                zip: address.pincode || address.zip || ''
            },
            items: orderItems,
            totalAmount: finalPayable,
            discountAmount: Math.round(discountAmount),
            couponCode: appliedCouponCode,
            partnerRef: partnerRef,
            paymentMethod: 'Cashfree',
            paymentStatus: 'Paid',
            status: isPurelyDigital ? 'Completed (Digital)' : 'Processing',
            orderType: isPurelyDigital ? 'digital' : 'physical',
            cashfreeOrderId: order_id,
            timeline: [{
                status: isPurelyDigital ? 'Completed (Digital)' : 'Paid',
                note: isPurelyDigital ? 'Digital Product Purchased & Unlocked' : 'Payment verified via Cashfree'
            }]
        });

        // Handle Digital Library Fulfillment
        const digitalItems = [];
        for (const item of orderItems) {
            if (item.type === 'EBOOK' || item.type === 'AUDIOBOOK') {
                const product = await Product.findById(item.productId);
                if (product) {
                    digitalItems.push({
                        productId: product._id,
                        title: product.title,
                        type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                        thumbnail: product.thumbnail,
                        filePath: product.filePath,
                        purchasedAt: new Date(),
                        orderId: newOrder.orderId,
                        accessStatus: 'active'
                    });
                }
            }
        }

        if (digitalItems.length > 0) {
            await DigitalLibrary.findOneAndUpdate(
                { userId: user._id.toString() },
                (lib) => {
                    if (!lib) return { userId: user._id.toString(), items: digitalItems, updatedAt: new Date().toISOString() };
                    if (!lib.items) lib.items = [];
                    digitalItems.forEach(di => {
                        if (!lib.items.some(li => (li.productId || '').toString() === di.productId.toString())) {
                            lib.items.push(di);
                        }
                    });
                    lib.updatedAt = new Date().toISOString();
                    return lib;
                },
                { upsert: true }
            );
            console.log(`✅ Digital items added to library for user: ${user.email}`);
        }

        // 🔔 Add Purchase Notification
        try {
            if (!user.notifications) user.notifications = [];
            user.notifications.unshift({
                _id: 'purchase-cf-' + Date.now(),
                title: isPurelyDigital ? 'Content Unlocked! 📖' : 'Purchase Successful! 🎉',
                message: isPurelyDigital ? `Your digital products from order #${newOrder.orderId} are now available in My Library.` : `Thank you for your order ${newOrder.orderId}. Your items are being processed.`,
                type: 'Order',
                link: isPurelyDigital ? 'profile.html?tab=library' : 'profile.html?tab=orders',
                isRead: false,
                createdAt: new Date().toISOString()
            });
            user.updatedAt = new Date().toISOString();
            await user.save();
        } catch (noteErr) {
            console.error('Purchase notification error:', noteErr);
        }

        // 🚛 Phase 2: Create Nimbus Shipment for Physical Items
        const physicalItems = orderItems.filter(i => i.type === 'HARDCOVER' || i.type === 'PAPERBACK');
        if (physicalItems.length > 0) {
            try {
                const nimbusPostService = require('../services/nimbusPostService');
                const { Shipment } = require('../models');

                console.log(`📦 Triggering Auto-Shipping for Order: ${newOrder.orderId}`);
                const shipResult = await nimbusPostService.automateShipping(newOrder, address, physicalItems, 'prepaid');

                if (shipResult.status) {
                    // Update Order
                    newOrder.shipmentId = shipResult.shipmentId;
                    newOrder.awbNumber = shipResult.awbNumber;
                    newOrder.courierName = shipResult.courierName;
                    newOrder.trackingLink = shipResult.trackingLink;
                    newOrder.labelUrl = shipResult.labelUrl;
                    newOrder.timeline.push({
                        status: 'Shipped',
                        note: `Shipment automated via ${shipResult.courierName}. AWB: ${shipResult.awbNumber}`
                    });
                    await newOrder.save();

                    // Create Shipment Record for history
                    await Shipment.create({
                        orderId: newOrder._id.toString(),
                        shipmentId: shipResult.shipmentId,
                        awbNumber: shipResult.awbNumber,
                        courierName: shipResult.courierName,
                        labelUrl: shipResult.labelUrl,
                        trackingLink: shipResult.trackingLink,
                        shippingStatus: 'Processing'
                    });

                    console.log(`✅ Nimbus Automation Complete for ${newOrder.orderId}`);
                } else {
                    console.warn(`⚠️ Nimbus Automation Failed for ${newOrder.orderId}:`, shipResult.message);
                    newOrder.timeline.push({ status: 'Processing', note: 'Auto-shipping failed: ' + shipResult.message });
                    await newOrder.save();
                }
            } catch (shipErr) {
                console.error('❌ Nimbus Automation Exception:', shipErr);
                newOrder.timeline.push({ status: 'Processing', note: 'Auto-shipping system error: ' + shipErr.message });
                await newOrder.save();
            }
        }

        // 💰 Process Partner Sale (Audit record & Partner Totals)
        if (newOrder.partnerRef) {
            await processPartnerSale(newOrder, newOrder.partnerRef);
        }

        res.status(201).json({
            success: true,
            order: newOrder,
            message: 'Payment verified and order placed'
        });

    } catch (error) {
        console.error('Cashfree Verification Error:', error);
        res.status(500).json({ message: 'Payment verification failed' });
    }
});

// Create Direct COD Order
router.post('/cod', protect, async (req, res) => {
    try {
        const { orderId, customer, items, couponCode } = req.body;
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // 1. Calculate Totals (Safeguard)
        let subtotal = 0;
        const processedItems = [];

        for (const item of items) {
            const product = await Product.findById(item.productId);
            if (!product) continue;

            const price = product.price * (1 - (product.discount || 0) / 100);
            subtotal += price * item.quantity;

            // 🚫 BLOCK DIGITAL ITEMS IN COD
            if (product.type === 'EBOOK' || product.type === 'AUDIOBOOK') {
                return res.status(400).json({
                    message: `Digital product '${product.title}' cannot be purchased via COD. Only Online Payment is available.`
                });
            }

            processedItems.push({
                productId: product._id,
                title: product.title,
                type: product.type,
                price: price,
                quantity: item.quantity
            });

            // Decrease stock for physical items
            if (product.type === 'HARDCOVER' || product.type === 'PAPERBACK') {
                if (product.stock >= item.quantity) {
                    await Product.findByIdAndUpdate(product._id, { $inc: { stock: -item.quantity } });
                }
            }
        }

        // Coupon Handling
        let discount = 0;
        let pRef = null;
        if (couponCode) {
            try {
                const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
                if (coupon) {
                    if (coupon.partner) pRef = coupon.partner;
                    if (coupon.type === 'Percentage') discount = (subtotal * coupon.value) / 100;
                    else discount = coupon.value;
                }
            } catch (err) { }
        }

        // SHIPPING & COD CHARGES Logic (Mirroring Prompt)
        const shippingCharge = req.body.shippingCharge || 42.48; // Default Zone B
        const codCharge = 36.58 + (subtotal * 0.0224);

        const finalAmount = Math.round(subtotal - discount + shippingCharge + codCharge);

        // 2. Create Order Record
        const { Order, Shipment, DigitalLibrary } = require('../models');
        const newOrder = await Order.create({
            orderId: orderId || ('COD-' + Date.now()),
            userId: user._id,
            customer: {
                name: customer.fullName || customer.name || 'Customer',
                email: customer.email,
                phone: customer.phone,
                address: customer.street + ', ' + (customer.area || ''),
                city: customer.city,
                state: customer.state,
                country: customer.country || 'India',
                pincode: customer.pincode
            },
            items: processedItems,
            totalAmount: finalAmount,
            shippingCharges: shippingCharge,
            codCharges: codCharge,
            discountAmount: discount,
            paymentMethod: 'COD',
            paymentStatus: 'Pending',
            status: 'Processing',
            couponCode: couponCode || '',
            partnerRef: pRef,
            timeline: [{
                status: 'Order Placed',
                note: 'Order placed via Cash on Delivery'
            }]
        });

        // 🚛 Phase 1: Digital Items fulfillment
        const digitalItems = processedItems.filter(i => i.type === 'EBOOK' || i.type === 'AUDIOBOOK');
        for (const item of digitalItems) {
            await DigitalLibrary.findOneAndUpdate(
                { userId: user._id, productId: item.productId },
                {
                    userId: user._id,
                    productId: item.productId,
                    purchaseDate: new Date(),
                    accessStatus: 'Active'
                },
                { upsert: true }
            );
        }

        // 🚛 Phase 2: Create Nimbus Shipment for Physical Items
        const physicalItems = processedItems.filter(i => i.type === 'HARDCOVER' || i.type === 'PAPERBACK');
        if (physicalItems.length > 0) {
            try {
                const nimbusPostService = require('../services/nimbusPostService');
                const { Shipment } = require('../models');

                const addressForShipping = {
                    fullName: customer.fullName || customer.name,
                    email: customer.email,
                    phone: customer.phone,
                    house: customer.street,
                    city: customer.city,
                    state: customer.state,
                    pincode: customer.pincode
                };

                console.log(`📦 Triggering Auto-Shipping for COD Order: ${newOrder.orderId}`);
                const shipResult = await nimbusPostService.automateShipping(newOrder, addressForShipping, physicalItems, 'cod');

                if (shipResult.status) {
                    newOrder.shipmentId = shipResult.shipmentId;
                    newOrder.awbNumber = shipResult.awbNumber;
                    newOrder.courierName = shipResult.courierName;
                    newOrder.trackingLink = shipResult.trackingLink;
                    newOrder.labelUrl = shipResult.labelUrl;
                    newOrder.timeline.push({
                        status: 'Shipped',
                        note: `COD Shipment automated via ${shipResult.courierName}. AWB: ${shipResult.awbNumber}`
                    });
                    await newOrder.save();

                    await Shipment.create({
                        orderId: newOrder._id.toString(),
                        shipmentId: shipResult.shipmentId,
                        awbNumber: shipResult.awbNumber,
                        courierName: shipResult.courierName,
                        labelUrl: shipResult.labelUrl,
                        trackingLink: shipResult.trackingLink,
                        shippingStatus: 'Processing'
                    });
                } else {
                    console.warn(`⚠️ Nimbus COD Automation Failed for ${newOrder.orderId}:`, shipResult.message);
                    newOrder.timeline.push({ status: 'Processing', note: 'Auto-shipping failed: ' + shipResult.message });
                    await newOrder.save();
                }
            } catch (err) {
                console.error('❌ COD Nimbus Automation Exception:', err);
                newOrder.timeline.push({ status: 'Fulfillment Issue', note: 'Auto-shipment system error: ' + err.message });
                await newOrder.save();
            }
        }

        // Notification
        if (!user.notifications) user.notifications = [];
        user.notifications.unshift({
            _id: 'purchase-cod-' + Date.now(),
            title: 'COD Order Confirmed! 📦',
            message: `Order ${newOrder.orderId} has been placed via COD. Total: ₹${newOrder.totalAmount}.`,
            type: 'Order',
            link: 'profile.html?tab=orders',
            createdAt: new Date().toISOString()
        });
        await user.save();

        res.status(201).json({ success: true, order: newOrder });

    } catch (error) {
        console.error('COD Place Error:', error);
        res.status(500).json({ message: 'Error placing COD order' });
    }
});



// Update Order Status (Admin Only)
router.put('/:id/status', adminAuth, async (req, res) => {
    try {
        const { status, note } = req.body;
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const oldStatus = order.status;
        order.status = status;
        order.timeline.push({ status, note: note || `Status updated to ${status}` });

        // --- NEW: Fulfill Digital Items on Payment/Delivery ---
        // If status becomes Paid/Delivered, unlock digital products for the user (only if not already paid)
        if (['Paid', 'Delivered'].includes(status) && !['Paid', 'Delivered'].includes(oldStatus)) {
            const userId = order.userId || (await User.findOne({ email: order.customer.email }))?._id;

            if (userId) {
                const digitalItems = [];
                for (const item of order.items) {
                    if (item.type === 'EBOOK' || item.type === 'AUDIOBOOK') {
                        const product = await Product.findById(item.productId);
                        if (product) {
                            digitalItems.push({
                                productId: product._id.toString(),
                                title: product.title,
                                type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                                thumbnail: product.thumbnail || 'img/vol1-cover.png',
                                filePath: product.filePath || '',
                                purchasedAt: new Date().toISOString()
                            });
                        }
                    }
                }

                if (digitalItems.length > 0) {
                    await DigitalLibrary.findOneAndUpdate(
                        { userId: userId.toString() },
                        (lib) => {
                            if (!lib) return { userId: userId.toString(), items: digitalItems, updatedAt: new Date().toISOString() };
                            if (!lib.items) lib.items = [];
                            digitalItems.forEach(di => {
                                if (!lib.items.some(li => (li.productId || '').toString() === di.productId.toString())) {
                                    lib.items.push(di);
                                }
                            });
                            lib.updatedAt = new Date().toISOString();
                            return lib;
                        },
                        { upsert: true }
                    );
                    console.log(`✅ Status Update: Digital items unlocked for ${order.customer.email}`);
                }
            }
        }

        // 🔔 Notification for Status Change
        if (status !== oldStatus) {
            try {
                const userId = order.userId || (await User.findOne({ email: order.customer.email }))?._id;
                if (userId) {
                    const user = await User.findById(userId);
                    if (user) {
                        if (!user.notifications) user.notifications = [];

                        let notification = null;
                        const orderIdDisplay = order.orderId || order._id;

                        switch (status) {
                            case 'Cancelled':
                                notification = {
                                    _id: 'status-cancel-' + Date.now(),
                                    title: 'Order Cancelled ❌',
                                    message: `Your order ${orderIdDisplay} has been cancelled.`,
                                    type: 'Order',
                                    link: 'profile.html?tab=orders',
                                    createdAt: new Date().toISOString()
                                };
                                break;
                            case 'Shipped':
                                notification = {
                                    _id: 'status-shipped-' + Date.now(),
                                    title: 'Order Shipped! 🚚',
                                    message: `Your order ${orderIdDisplay} is out for delivery.`,
                                    type: 'Order',
                                    link: 'profile.html?tab=orders',
                                    createdAt: new Date().toISOString()
                                };
                                break;
                            case 'Delivered':
                                notification = {
                                    _id: 'status-delivered-' + Date.now(),
                                    title: 'Order Delivered! 🎉',
                                    message: `Your order ${orderIdDisplay} has been delivered successfully.`,
                                    type: 'Order',
                                    link: 'profile.html?tab=orders',
                                    createdAt: new Date().toISOString()
                                };
                                break;
                        }

                        if (notification) {
                            user.notifications.unshift(notification);
                            await user.save();
                            console.log(`🔔 Status notification (${status}) sent to ${user.email}`);
                        }
                    }
                }
            } catch (notifyErr) {
                console.error('Error sending status notification:', notifyErr);
            }
        }

        await order.save();
        res.json(order);
    } catch (error) {
        console.error('Update Status Error:', error);
        res.status(500).json({ message: 'Error updating status' });
    }
});

// Track Order (Public/User)
router.get('/track/:id', async (req, res) => {
    try {
        const order = await Order.findOne({ orderId: req.params.id }) || await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Convert to POJO to merge data safely
        const orderObj = order.toObject ? order.toObject() : JSON.parse(JSON.stringify(order));

        // If shipment fields are missing, try to find in Shipment collection
        if (!orderObj.awbNumber) {
            try {
                const { Shipment } = require('../models');
                const shipment = await Shipment.findOne({ orderId: order._id.toString() });
                if (shipment) {
                    orderObj.awbNumber = shipment.awbNumber;
                    orderObj.courierName = shipment.courierName;
                    orderObj.trackingLink = shipment.trackingLink;
                    orderObj.shipmentId = shipment.shipmentId;
                }
            } catch (shipErr) {
                console.warn('Shipment lookup fail during track:', shipErr.message);
            }
        }

        res.json(orderObj);
    } catch (error) {
        console.error('Track Error:', error);
        res.status(500).json({ message: 'Error tracking order' });
    }
});

// --- NEW: TEST MODE DIGITAL PURCHASE ---
// Directly creates an order as PAID and Adds to Library
router.post('/test-digital', protect, async (req, res) => {
    try {
        const { productId, price, name, type } = req.body; // type should be 'EBOOK' or 'AUDIOBOOK'
        const user = await User.findById(req.user._id);

        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // 1. Find Product
        // IMPORTANT: In JSON DB mode, IDs are strings like 'efv_v1_ebook'.
        // mongoose.Types.ObjectId.isValid() returns FALSE for these, so we CANNOT
        // use that check as a gate. Try findById for ALL productIds first.
        let product = null;

        // Step 1a: Try direct ID lookup (works for both string and ObjectId formats)
        product = await Product.findById(productId.toString());

        // Step 1b: If not found, try demoMap with simple string matching (JSON-safe)
        if (!product) {
            // Simple mapping: productId -> { type, titleFragment }
            const demoMap = {
                'efv_v1_ebook': { type: 'EBOOK', titleFragment: 'ORIGIN CODE' },
                'efv_v1_audiobook': { type: 'AUDIOBOOK', titleFragment: 'ORIGIN CODE' },
                'efv_v1_ebook_en': { type: 'EBOOK', titleFragment: 'THE ORIGIN CODE' },
                'efv_v1_audiobook_en': { type: 'AUDIOBOOK', titleFragment: 'THE ORIGIN CODE' },
                'efv_v2_ebook': { type: 'EBOOK', titleFragment: 'MINDOS' },
                'efv_v2_audiobook': { type: 'AUDIOBOOK', titleFragment: 'MINDOS' }
            };

            const spec = demoMap[productId];
            if (spec) {
                // JSON adapter supports regex in find(), use it
                product = await Product.findOne({
                    title: new RegExp(spec.titleFragment, 'i'),
                    type: spec.type
                });
            }
        }

        // Step 1c: Last resort - search by name sent from frontend
        if (!product && name) {
            product = await Product.findOne({ title: new RegExp(name.replace(/[™®]/g, '').trim(), 'i'), type: type });
        }

        if (!product) {
            console.error(`❌ Product not found for ID: ${productId}, name: ${name}, type: ${type}`);
            return res.status(404).json({ success: false, message: `Product not found: ${productId}` });
        }

        console.log(`✅ Product found: ${product.title} (${product.type}) ID: ${product._id}`);


        // 2. Create Order (Simulate Paid)
        const orderId = 'ORD-TEST-' + Date.now().toString().slice(-6);
        const newOrder = await Order.create({
            orderId: orderId,
            customer: {
                name: user.name,
                email: user.email,
                phone: user.phone || '0000000000',
                address: { street: 'Digital Purchase', city: 'Internet', zip: '000000' }
            },
            items: [{
                productId: product._id,
                title: product.title,
                type: product.type, // Ensure DB type is used (EBOOK/AUDIOBOOK)
                price: price || product.price,
                quantity: 1
            }],
            totalAmount: price || product.price,
            paymentMethod: 'DIGITAL_TEST',
            paymentStatus: 'Paid',
            status: 'Delivered', // Immediate delivery for digital
            paymentId: 'DIG-' + orderId,
            timeline: [{ status: 'Delivered', note: 'Digital Item Unlocked (Test Mode)' }]
        });

        // 3. Update User Profile (Add to purchasedProducts)
        const prodIdStr = product._id.toString();
        await User.findByIdAndUpdate(user._id, (u) => {
            if (!u.purchasedProducts) u.purchasedProducts = [];
            const isAlreadyPurchased = u.purchasedProducts.some(id => id.toString() === prodIdStr);
            if (!isAlreadyPurchased) {
                u.purchasedProducts.push(prodIdStr);
            }
            u.updatedAt = new Date().toISOString();
            return u;
        });

        // 4. Update Digital Library
        await DigitalLibrary.findOneAndUpdate(
            { userId: user._id.toString() },
            (lib) => {
                if (!lib) {
                    return {
                        userId: user._id.toString(),
                        items: [{
                            productId: product._id.toString(),
                            title: product.title,
                            type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                            thumbnail: product.thumbnail || 'img/vol1-cover.png',
                            filePath: product.filePath || '',
                            purchasedAt: new Date().toISOString()
                        }],
                        updatedAt: new Date().toISOString()
                    };
                }
                if (!lib.items) lib.items = [];
                const alreadyInLib = lib.items.some(i => (i.productId || '').toString() === product._id.toString());
                if (!alreadyInLib) {
                    lib.items.push({
                        productId: product._id.toString(),
                        title: product.title,
                        type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                        thumbnail: product.thumbnail || 'img/vol1-cover.png',
                        filePath: product.filePath || '',
                        purchasedAt: new Date().toISOString()
                    });
                }
                lib.updatedAt = new Date().toISOString();
                return lib;
            },
            { upsert: true }
        );

        // 🔔 Add Purchase Notification (Test Mode)
        try {
            await User.findByIdAndUpdate(user._id, (u) => {
                if (!u.notifications) u.notifications = [];
                u.notifications.unshift({
                    _id: 'purchase-test-' + Date.now(),
                    title: 'Item Unlocked! 🔓',
                    message: `"${product.title}" has been successfully added to your library.`,
                    type: 'Order',
                    link: 'profile.html?tab=library',
                    isRead: false,
                    createdAt: new Date().toISOString()
                });
                u.updatedAt = new Date().toISOString();
                return u;
            });
        } catch (noteErr) {
            console.error('Test purchase notification error:', noteErr);
        }

        res.status(200).json({
            success: true,
            message: 'Test Purchase Successful',
            orderId: newOrder.orderId,
            libraryUpdated: true
        });

    } catch (error) {
        console.error("Test Digital Purchase Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete Order (Admin Only)
router.delete('/:id', adminAuth, async (req, res) => {
    console.log(`🗑️ Admin: Deleting Order Request for ID: ${req.params.id}`);
    try {
        const order = await Order.findByIdAndDelete(req.params.id) || await Order.findOneAndDelete({ orderId: req.params.id });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Delete Order Error:', error);
        res.status(500).json({ message: 'Error deleting order' });
    }
});

// ============================================================
// CANCEL ORDER ROUTE (User + Admin)
// ============================================================
router.post('/cancel/:orderId', protect, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { reason } = req.body;
        const nimbusPostService = require('../services/nimbusPostService');
        const { OrderCancellation } = require('../models');

        // Fetch order
        const order = await Order.findOne({ orderId });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Security: Only owner or admin can cancel
        const isAdmin = req.user.role === 'admin' || req.user.email?.toLowerCase() === 'admin@uwo24.com';
        const isOwner = order.userId?.toString() === req.user._id?.toString() ||
            order.customer?.email?.toLowerCase() === req.user.email?.toLowerCase();
        if (!isAdmin && !isOwner) {
            return res.status(403).json({ message: 'Unauthorized to cancel this order' });
        }

        // Shipment Status Check — cannot cancel if already picked up
        const blockedStatuses = ['Picked Up', 'In Transit', 'Out for Delivery', 'Delivered'];
        if (blockedStatuses.includes(order.status)) {
            return res.status(400).json({
                message: 'Order already picked up. Cancellation is no longer available.'
            });
        }

        // Already cancelled?
        if (order.status === 'Cancelled') {
            return res.status(400).json({ message: 'Order is already cancelled' });
        }

        // Step 1: Cancel on NimbusPost if AWB exists
        let nimbusResult = null;
        if (order.awbNumber) {
            nimbusResult = await nimbusPostService.cancelShipment(order.awbNumber);
            if (!nimbusResult.status) {
                console.warn(`⚠️ NimbusPost cancel failed for ${order.awbNumber}: ${nimbusResult.message}`);
                // We proceed with DB cancellation anyway to avoid blocking user
            }
        }

        // Step 2: Update order status to Cancelled
        order.status = 'Cancelled';
        order.timeline.push({
            status: 'Cancelled',
            note: reason || 'Cancelled by user',
            timestamp: new Date()
        });
        await order.save();

        // Step 3: Save cancellation record
        await OrderCancellation.create({
            orderId: order.orderId,
            userId: req.user._id,
            reason: reason || 'User requested cancellation',
            cancelledAt: new Date()
        });

        // Step 4: Send notification to user
        const user = await User.findById(req.user._id);
        if (user) {
            user.notifications.push({
                title: 'Order Cancelled',
                message: `Your order #${order.orderId} has been cancelled. Refund (if applicable) will be processed within 5–7 business days.`,
                type: 'Order',
                isRead: false
            });
            await user.save();
        }

        res.json({
            success: true,
            message: 'Your order has been cancelled successfully.',
            nimbusStatus: nimbusResult?.status ? 'Shipment cancelled on NimbusPost' : 'Manual DB cancel (NimbusPost may need manual update)'
        });

    } catch (error) {
        console.error('Cancel Order Error:', error);
        res.status(500).json({ message: 'Server error while cancelling order' });
    }
});

module.exports = router;
