const express = require('express');
const router = express.Router();
const { Order, Product, User, DigitalLibrary, Coupon } = require('../models');
const adminAuth = require('../middleware/adminAuth');
const { protect } = require('../middleware/auth');
const { createRazorpayOrder, verifyPaymentSignature } = require('../utils/razorpay');
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
        razorpayKeyId: process.env.RAZORPAY_KEY_ID
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

// Create Razorpay Order
router.post('/razorpay', protect, async (req, res) => {
    try {
        const { amount, currency } = req.body;
        if (!amount) return res.status(400).json({ message: 'Amount is required' });

        const rzpOrder = await createRazorpayOrder(amount, currency || 'INR');
        res.json(rzpOrder);
    } catch (error) {
        res.status(500).json({ message: 'Failed to create Razorpay order' });
    }
});

// Create Cashfree Order
router.post('/cashfree', protect, async (req, res) => {
    try {
        const { amount, customerName, customerPhone, customerEmail } = req.body;
        if (!amount) return res.status(400).json({ message: 'Amount is required' });

        const roundedAmount = Number(amount).toFixed(2);

        const cfOrder = await createCashfreeOrder({
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
            totalAmount: finalPayable, // Use discounted amount
            discountAmount: Math.round(discountAmount),
            couponCode: appliedCouponCode,
            partnerRef: partnerRef,
            paymentMethod: 'Cashfree',
            paymentStatus: 'Paid',
            status: 'Processing',
            cashfreeOrderId: order_id,
            timeline: [{ status: 'Paid', note: 'Payment verified via Cashfree' }]
        });

        // Handle Digital Library Fulfillment (Same as Razorpay)
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
                        purchasedAt: new Date()
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

        // 🔔 Add Purchase Notification (directly on already-fetched user)
        try {
            if (!user.notifications) user.notifications = [];
            user.notifications.unshift({
                _id: 'purchase-cf-' + Date.now(),
                title: 'Purchase Successful! 🎉',
                message: `Thank you for your order ${newOrder.orderId}. Your items are being processed.`,
                type: 'Order',
                link: 'profile.html?tab=orders',
                isRead: false,
                createdAt: new Date().toISOString()
            });
            user.updatedAt = new Date().toISOString();
            await user.save();
            console.log(`🔔 Purchase notification saved for ${user.email}`);
        } catch (noteErr) {
            console.error('Purchase notification error:', noteErr);
        }

        // 🚛 Phase 2: Create Nimbus Shipment for Physical Items
        const physicalItems = orderItems.filter(i => i.type === 'HARDCOVER' || i.type === 'PAPERBACK');
        if (physicalItems.length > 0) {
            try {
                const nimbusPostService = require('../services/nimbusPostService');
                const { Shipment } = require('../models');

                const addressLine = [
                    address.house, address.street, address.area, address.landmark, address.fullAddress,
                    address.city, address.state, address.pincode
                ].filter(item => item && item.toString().trim().length > 0).join(', ') || 'Address not provided';

                const nimbusPayload = {
                    order_number: newOrder.orderId,
                    consignee: {
                        name: address.fullName || user.name || 'Customer',
                        email: address.email || user.email,
                        phone: address.phone || user.phone || '0000000000',
                        address: addressLine,
                        city: address.city || 'Unknown',
                        state: address.state || (address.city === 'Jabalpur' || address.pincode && address.pincode.startsWith('48') ? 'Madhya Pradesh' : 'Unknown'),
                        pincode: address.pincode || address.zip || '000000',
                        country: 'India'
                    },
                    pickup: {
                        warehouse_name: "Office",
                        name: "Abha",
                        contact_name: "Abha",
                        phone: "9798780000",
                        email: "sreshthi+3296@uwo24.com",
                        address: "Badar Cantt, Jabalpur",
                        city: "Jabalpur",
                        state: "Madhya Pradesh",
                        pincode: "482001"
                    },
                    order_items: physicalItems.map(i => ({
                        name: i.title,
                        qty: i.quantity,
                        price: i.price,
                        sku: i.title
                    })),
                    payment_type: 'prepaid',
                    order_amount: newOrder.totalAmount,
                    order_total: newOrder.totalAmount,
                    weight: physicalItems.reduce((sum, i) => sum + (i.weight || 500) * i.quantity, 0),
                    length: 10, breadth: 10, height: 10
                };

                console.log('📦 Auto Nimbus Shipment Payload (Cashfree):', JSON.stringify(nimbusPayload, null, 2));
                const nimbusResult = await nimbusPostService.createShipment(nimbusPayload);
                console.log('📄 Auto Nimbus API Result (Cashfree):', JSON.stringify(nimbusResult, null, 2));

                if (nimbusResult.status && nimbusResult.data) {
                    const shipInfo = nimbusResult.data;
                    const shipment = await Shipment.create({
                        orderId: newOrder._id.toString(),
                        shipmentId: shipInfo.shipment_id || (nimbusResult.data && typeof nimbusResult.data === 'string' ? nimbusResult.data : ''),
                        awbNumber: shipInfo.awb_number || '',
                        courierName: shipInfo.courier_name || 'NimbusPost',
                        shippingStatus: 'Processing',
                        trackingLink: shipInfo.tracking_url || ''
                    });

                    newOrder.shipmentId = shipment.shipmentId;
                    newOrder.awbNumber = shipment.awbNumber;
                    newOrder.courierName = shipment.courierName;
                    newOrder.trackingLink = shipment.trackingLink;
                    newOrder.timeline.push({ status: 'Processing', note: `Shipment created automatically (AWB: ${shipment.awbNumber})` });
                    await newOrder.save();
                    console.log(`✅ Nimbus shipment created for ${newOrder.orderId}`);
                } else {
                    const errMsg = nimbusResult.message || 'Unknown Nimbus API Error';
                    console.warn(`⚠️ Nimbus Shipment Failed for ${newOrder.orderId}:`, errMsg);
                    newOrder.timeline.push({ status: 'Payment Verified', note: 'Auto-shipment failed: ' + errMsg });
                    await newOrder.save();
                }
            } catch (shipErr) {
                console.error('❌ Automatic Nimbus Shipment Exception:', shipErr);
                newOrder.timeline.push({ status: 'Payment Verified', note: 'Auto-shipment system error: ' + shipErr.message });
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
                const addressLine = [customer.street, customer.area, customer.city, customer.state, customer.pincode].filter(Boolean).join(', ');

                const nimbusPayload = {
                    order_number: newOrder.orderId,
                    consignee: {
                        name: newOrder.customer.name,
                        email: newOrder.customer.email,
                        phone: newOrder.customer.phone,
                        address: addressLine,
                        city: newOrder.customer.city,
                        state: newOrder.customer.state || 'Madhya Pradesh',
                        pincode: newOrder.customer.pincode,
                        country: 'India'
                    },
                    pickup: {
                        warehouse_name: "Office",
                        name: "Abha",
                        contact_name: "Abha",
                        phone: "9798780000",
                        address: "Badar Cantt, Jabalpur",
                        city: "Jabalpur",
                        state: "Madhya Pradesh",
                        pincode: "482001"
                    },
                    order_items: physicalItems.map(i => ({
                        name: i.title,
                        qty: i.quantity,
                        price: i.price,
                        sku: i.title
                    })),
                    payment_type: 'cod',
                    order_amount: newOrder.totalAmount,
                    order_total: newOrder.totalAmount,
                    weight: 500 * physicalItems.length,
                    length: 10, breadth: 10, height: 10
                };

                const nimbusResult = await nimbusPostService.createShipment(nimbusPayload);
                if (nimbusResult.status && nimbusResult.data) {
                    const shipInfo = nimbusResult.data;
                    const shipment = await Shipment.create({
                        orderId: newOrder._id.toString(),
                        shipmentId: shipInfo.shipment_id || '',
                        awbNumber: shipInfo.awb_number || '',
                        courierName: shipInfo.courier_name || 'NimbusPost',
                        shippingStatus: 'Processing',
                        trackingLink: shipInfo.tracking_url || ''
                    });

                    newOrder.shipmentId = shipment.shipmentId;
                    newOrder.awbNumber = shipment.awbNumber;
                    newOrder.timeline.push({ status: 'Shipment Created', note: `Nimbus shipment AWB: ${shipment.awbNumber}` });
                    await newOrder.save();
                }
            } catch (err) {
                console.error('COD Shipment Error:', err);
                newOrder.timeline.push({ status: 'Fulfillment Issue', note: 'Auto-shipment skipped: ' + err.message });
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
            link: 'profile.html?tab=orders'
        });
        await user.save();

        res.status(201).json({ success: true, order: newOrder });

    } catch (error) {
        console.error('COD Place Error:', error);
        res.status(500).json({ message: 'Error placing COD order' });
    }
});

// Verify Payment and Finalize Order
router.post('/verify', protect, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            checkoutData,
            customer: directCustomer,
            items: directItems
        } = req.body;

        // 1. Verify Signature
        const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
        if (!isValid) {
            return res.status(400).json({ message: 'Invalid payment signature' });
        }

        // 2. Fulfill Order
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Flexible extraction of items and address
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
            // Find product to get latest price/stock
            const product = await Product.findById(item.id || item.productId);
            if (!product) {
                console.warn(`Product not found during verification: ${item.id || item.productId}`);
                continue;
            }

            totalAmount += product.price * item.quantity;
            orderItems.push({
                productId: product._id,
                title: product.title,
                type: product.type,
                price: product.price,
                quantity: item.quantity
            });
        }

        if (orderItems.length === 0) return res.status(400).json({ message: 'No valid products found in order' });

        const newOrder = await Order.create({
            orderId: 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000),
            userId: user._id,
            customer: {
                name: address.fullName || user.name,
                email: address.email || user.email,
                phone: address.phone || user.phone || '0000000000',
                address: address, // Store the full address object
                city: address.city || '',
                zip: address.pincode || address.zip || ''
            },
            items: orderItems,
            totalAmount: Math.round(totalAmount * 1.18), // Including 18% GST as per frontend calc
            paymentMethod: 'Razorpay',
            paymentStatus: 'Paid',
            status: 'Processing',
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            razorpaySignature: razorpay_signature,
            timeline: [{ status: 'Paid', note: 'Payment verified via Razorpay' }]
        });

        // 3. Handle Digital Library Fulfillment
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
                        purchasedAt: new Date()
                    });
                }
            }
        }

        if (digitalItems.length > 0) {
            await DigitalLibrary.findOneAndUpdate(
                { userId: user._id.toString() },
                (lib) => {
                    if (!lib) {
                        return { userId: user._id.toString(), items: digitalItems, updatedAt: new Date().toISOString() };
                    }
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

        // 🔔 Add Purchase Notification (directly on already-fetched user)
        try {
            if (!user.notifications) user.notifications = [];
            user.notifications.unshift({
                _id: 'purchase-' + Date.now(),
                title: 'Purchase Successful! 🎉',
                message: `Thank you for your order ${newOrder.orderId}. Your items are being processed.`,
                type: 'Order',
                link: 'profile.html?tab=orders',
                isRead: false,
                createdAt: new Date().toISOString()
            });
            user.updatedAt = new Date().toISOString();
            await user.save();
            console.log(`🔔 Purchase notification saved for ${user.email}`);
        } catch (noteErr) {
            console.error('Purchase notification error:', noteErr);
        }

        // 🚛 Phase 2: Create Nimbus Shipment for Physical Items
        const physicalItems = orderItems.filter(i => i.type === 'HARDCOVER' || i.type === 'PAPERBACK');
        if (physicalItems.length > 0) {
            try {
                const nimbusPostService = require('../services/nimbusPostService');
                const { Shipment } = require('../models');

                const addressLine = [
                    address.house, address.street, address.area, address.landmark, address.fullAddress,
                    address.city, address.state, address.pincode
                ].filter(item => item && item.toString().trim().length > 0).join(', ') || 'Address not provided';

                // Prepare Nimbus Payload (Confirmed working format)
                const nimbusPayload = {
                    order_number: newOrder.orderId,
                    consignee: {
                        name: address.fullName || user.name || 'Customer',
                        email: address.email || user.email,
                        phone: address.phone || user.phone || '0000000000',
                        address: addressLine,
                        city: address.city || 'Unknown',
                        state: address.state || (address.city === 'Jabalpur' || address.pincode && address.pincode.startsWith('48') ? 'Madhya Pradesh' : 'Unknown'),
                        pincode: address.pincode || address.zip || '000000',
                        country: 'India'
                    },
                    pickup: {
                        warehouse_name: "Office",
                        name: "Abha",
                        contact_name: "Abha",
                        phone: "9798780000",
                        email: "sreshthi+3296@uwo24.com",
                        address: "Badar Cantt, Jabalpur",
                        city: "Jabalpur",
                        state: "Madhya Pradesh",
                        pincode: "482001"
                    },
                    order_items: physicalItems.map(i => ({
                        name: i.title,
                        qty: i.quantity,
                        price: i.price,
                        sku: i.title
                    })),
                    payment_type: 'prepaid',
                    order_amount: newOrder.totalAmount,
                    order_total: newOrder.totalAmount,
                    weight: physicalItems.reduce((sum, i) => sum + (i.weight || 500) * i.quantity, 0),
                    length: 10, breadth: 10, height: 10
                };

                console.log('📦 Auto Nimbus Shipment Payload:', JSON.stringify(nimbusPayload, null, 2));
                const nimbusResult = await nimbusPostService.createShipment(nimbusPayload);
                console.log('📄 Auto Nimbus API Result:', JSON.stringify(nimbusResult, null, 2));

                if (nimbusResult.status && nimbusResult.data) {
                    const shipInfo = nimbusResult.data;
                    const shipment = await Shipment.create({
                        orderId: newOrder._id.toString(),
                        shipmentId: shipInfo.shipment_id || (nimbusResult.data && typeof nimbusResult.data === 'string' ? nimbusResult.data : ''),
                        awbNumber: shipInfo.awb_number || '',
                        courierName: shipInfo.courier_name || 'NimbusPost',
                        shippingStatus: 'Processing',
                        trackingLink: shipInfo.tracking_url || ''
                    });

                    newOrder.shipmentId = shipment.shipmentId;
                    newOrder.awbNumber = shipment.awbNumber;
                    newOrder.courierName = shipment.courierName;
                    newOrder.trackingLink = shipment.trackingLink;
                    newOrder.status = 'Processing';
                    newOrder.timeline.push({ status: 'Processing', note: `Shipment created automatically via NimbusPost (AWB: ${shipment.awbNumber})` });
                    await newOrder.save();
                    console.log(`✅ Nimbus shipment created for ${newOrder.orderId}`);
                } else {
                    const errMsg = nimbusResult.message || 'Unknown Nimbus API Error';
                    console.warn(`⚠️ Nimbus Shipment Failed for ${newOrder.orderId}:`, errMsg);
                    newOrder.timeline.push({ status: 'Payment Verified', note: 'Auto-shipment failed: ' + errMsg });
                    await newOrder.save();
                }
            } catch (shipErr) {
                console.error('❌ Automatic Nimbus Shipment Exception:', shipErr);
                newOrder.timeline.push({ status: 'Payment Verified', note: 'Auto-shipment system error: ' + shipErr.message });
                await newOrder.save();
            }
        }

        res.status(201).json({
            success: true,
            order: newOrder,
            message: 'Payment verified and order placed'
        });

    } catch (error) {
        console.error('Verification Error:', error);
        res.status(500).json({ message: 'Payment verification failed' });
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

module.exports = router;
