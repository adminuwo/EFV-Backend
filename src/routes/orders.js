const express = require('express');
const router = express.Router();
const { Order, Product, User, DigitalLibrary, Coupon, Cart } = require('../models');
const adminAuth = require('../middleware/adminAuth');
const { protect } = require('../middleware/auth');
const { createCashfreeOrder, verifyCashfreePayment } = require('../utils/cashfree');
const { createRazorpayOrder, verifyRazorpaySignature, fetchRazorpayPayment } = require('../utils/razorpay');
const { processPartnerSale } = require('../utils/partnerUtils');
const path = require('path');
const whatsappService = require('../services/whatsappService');
const jobService = require('../services/jobService');


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
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
        // Cashfree kept for backward-compat (disabled)
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

// Get single order (Admin or Owner)
router.get('/:id', protect, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Security check: Only admin or owner
        const isAdmin = req.user.role === 'admin' || req.user.email?.toLowerCase() === 'admin@uwo24.com';
        const isOwner = order.userId?.toString() === req.user._id?.toString() || 
                       order.customer?.email?.toLowerCase() === req.user.email?.toLowerCase();
        
        if (!isAdmin && !isOwner) {
            return res.status(403).json({ message: 'Unauthorized access' });
        }

        res.json(order);
    } catch (error) {
        console.error('Fetch Order Error:', error);
        res.status(500).json({ message: 'Error fetching order details' });
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
            const cleanedCode = (couponCode || '').trim().toUpperCase();
            console.log(`🔍 [COD] Checking coupon: "${cleanedCode}"`);
            const coupon = await Coupon.findOne({ code: cleanedCode, isActive: true });
            
            if (coupon) {
                console.log(`✅ [COD] Coupon found: ${coupon.code}. isPartner: ${coupon.isPartnerCoupon}`);
                const isExpired = coupon.expiryDate && new Date(coupon.expiryDate) < new Date();
                const isUnderMin = totalAmount < (coupon.minOrder || 0);
                const isLimitReached = (coupon.usedCount || 0) >= (coupon.usageLimit || 1000);

                if (!isExpired && !isUnderMin && !isLimitReached) {
                    discountAmount = coupon.type === 'Percentage'
                        ? (totalAmount * (coupon.value || 0)) / 100
                        : (coupon.value || 0);
                    
                    discountAmount = Math.min(discountAmount, totalAmount);
                    appliedCouponCode = coupon.code;

                    // Update usage
                    coupon.usedCount = (coupon.usedCount || 0) + 1;
                    await coupon.save();

                    // If it's a partner coupon, associate with the order
                    if (coupon.isPartnerCoupon && coupon.partnerId) {
                        partnerRef = {
                            partnerId: coupon.partnerId.toString(),
                            partnerName: coupon.partnerName || 'Unknown Partner',
                            couponCode: coupon.code,
                            commissionPercent: (coupon.commissionPercent || 0),
                            commissionAmount: Math.round((totalAmount * (coupon.commissionPercent || 0)) / 100),
                            commissionPaid: false
                        };
                        console.log(`💰 [COD] Partner Ref Attached: ${partnerRef.partnerName}`);
                    }
                } else {
                    console.log(`⚠️ [COD] Coupon checks failed: Expired=${isExpired}, UnderMin=${isUnderMin}`);
                }
            } else {
                console.log(`❌ [COD] Coupon "${cleanedCode}" not found`);
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

        const address = {
            fullName: customer.fullName || customer.name || 'Customer',
            email: customer.email,
            phone: customer.phone || '0000000000',
            house: customer.street || customer.house || '',
            area: customer.area || '',
            city: customer.city || 'Unknown',
            state: customer.state || '',
            pincode: customer.pincode || customer.zip || '000000',
            country: customer.country || 'India'
        };

        const newOrder = await Order.create({
            orderId: 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000),
            userId: userId,
            customer: {
                ...address,
                name: address.fullName,
                address: address, // Store nested object too for UI parity
                zip: address.pincode,
                city: address.city
            },
            items: orderItems,
            subtotal: Math.round(totalAmount),
            taxAmount: Math.round(finalAmount - (finalAmount / 1.18)),
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
                const user = await User.findById(userId);
                if (user) {
                    if (!user.notifications) user.notifications = [];
                    user.notifications.unshift({
                        _id: 'purchase-cod-' + Date.now(),
                        title: 'Order Placed! 📦',
                        message: `Wait for confirmation! Your order ${newOrder.orderId} (COD) has been placed.`,
                        type: 'Order',
                        link: 'profile.html?tab=orders',
                        isRead: false,
                        createdAt: new Date().toISOString()
                    });
                    user.markModified('notifications');
                    await user.save();
                }
            } catch (noteErr) {
                console.error('COD notification error:', noteErr);
            }
        }

        // 💰 Process Partner Sale (Audit record & Partner Totals)
        if (newOrder.partnerRef) {
            await processPartnerSale(newOrder, newOrder.partnerRef);
        }

        // 🕒 Schedule Delayed WhatsApp Order Confirmation (2 min delay)
        try {
            await jobService.schedule(newOrder.userId || customer.email, 'OrderPlaced', 2, { orderId: newOrder.orderId });
            // Cancel any pending Abandoned Cart jobs for this user
            if (newOrder.userId) {
                await jobService.cancel(newOrder.userId, 'AbandonedCart');
                await Cart.findOneAndUpdate({ userId: newOrder.userId }, { isPurchased: true, remindersSent: 0 });
            }
        } catch (err) {
            console.error('Job Scheduling Error:', err);
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
        const { amount, currency, customerName, customerPhone, customerEmail } = req.body;
        if (!amount) return res.status(400).json({ message: 'Amount is required' });

        const orderId = `EFV-CF-${Date.now()}`;
        const roundedAmount = Number(amount).toFixed(2);

        const cfOrder = await createCashfreeOrder({
            orderId: orderId,
            amount: Number(roundedAmount),
            currency: currency || 'INR', // Accepting USD or INR from frontend
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
        const { order_id, currency, checkoutData, customer: directCustomer, items: directItems, couponCode } = req.body;

        if (!order_id) return res.status(400).json({ message: 'Order ID is required' });

        // 🟢 PREVENT DUPLICATE ORDERS: Check if this Cashfree Order ID was already processed
        const existingOrder = await Order.findOne({ cashfreeOrderId: order_id });
        if (existingOrder) {
            console.log(`ℹ️ Cashfree verification called for already fulfilled order: ${order_id}`);
            return res.status(200).json({
                success: true,
                order: existingOrder,
                message: 'Order was already processed successfully'
            });
        }

        // 1. Verify Payment with Cashfree
        const payments = await verifyCashfreePayment(order_id);
        const successfulPayment = payments.find(p => p.payment_status === 'SUCCESS');

        if (!successfulPayment) {
            console.warn(`⚠️ Cashfree Payment Verification Failed for Order: ${order_id}`);
            return res.status(400).json({ message: 'Payment not successful or not found' });
        }

        console.log(`✅ Cashfree Payment Verified for Order: ${order_id}. Initializing fulfillment...`);

        // ... [Rest of the fulfillment logic remains same, just ensuring it's wrapped correctly]
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
                    house: directCustomer.street || directCustomer.address || '',
                    area: directCustomer.area || '',
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

        let discountAmount = 0;
        let partnerRef = null;
        let appliedCouponCode = '';

        if (couponCode) {
            const cleanedCode = (couponCode || '').trim().toUpperCase();
            const coupon = await Coupon.findOne({ code: cleanedCode, isActive: true });
            if (coupon) {
                const isExpired = coupon.expiryDate && new Date(coupon.expiryDate) < new Date();
                const isUnderMin = totalAmount < (coupon.minOrder || 0);
                const isLimitReached = coupon.usedCount >= coupon.usageLimit;

                if (!isExpired && !isUnderMin && !isLimitReached) {
                    discountAmount = coupon.type === 'Percentage'
                        ? (totalAmount * (coupon.value || 0)) / 100
                        : (coupon.value || 0);
                    discountAmount = Math.min(discountAmount, totalAmount);
                    appliedCouponCode = coupon.code;

                    // Increment used count for Cashfree orders
                    coupon.usedCount = (coupon.usedCount || 0) + 1;
                    await coupon.save();

                    if (coupon.isPartnerCoupon && coupon.partnerId) {
                        partnerRef = {
                            partnerId: coupon.partnerId.toString(),
                            partnerName: coupon.partnerName || 'Unknown Partner',
                            couponCode: coupon.code,
                            commissionPercent: (coupon.commissionPercent || 0),
                            commissionAmount: Math.round((totalAmount * (coupon.commissionPercent || 0)) / 100),
                            commissionPaid: false
                        };
                    }
                }
            }
        }

        const finalPayable = Math.round(totalAmount - discountAmount);
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
            currency: currency || 'INR', // Store the currency used for payment
            timeline: [{
                status: isPurelyDigital ? 'Completed (Digital)' : 'Paid',
                note: isPurelyDigital ? 'Digital Product Purchased & Unlocked' : `Payment verified via Cashfree (${currency || 'INR'})`
            }]
        });

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
            let library = await DigitalLibrary.findOne({ userId: user._id.toString() });
            if (!library) {
                library = new DigitalLibrary({ userId: user._id.toString(), items: [] });
            }
            if (!library.items) library.items = [];

            digitalItems.forEach(di => {
                if (!library.items.some(li => (li.productId || '').toString() === di.productId.toString())) {
                    library.items.push(di);
                }
            });
            library.updatedAt = new Date().toISOString();
            await library.save();
        }

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
        } catch (noteErr) {}

        const physicalItems = orderItems.filter(i => i.type === 'HARDCOVER' || i.type === 'PAPERBACK');
        if (physicalItems.length > 0) {
            try {
                const nimbusPostService = require('../services/nimbusPostService');
                const { Shipment } = require('../models');
                const shipResult = await nimbusPostService.automateShipping(newOrder, address, physicalItems, 'prepaid');

                if (shipResult.status) {
                    newOrder.shipmentId = shipResult.shipmentId;
                    newOrder.awbNumber = shipResult.awbNumber;
                    newOrder.courierName = shipResult.courierName;
                    newOrder.trackingLink = shipResult.trackingLink;
                    newOrder.labelUrl = shipResult.labelUrl;
                    newOrder.timeline.push({ status: 'Shipped', note: `Shipment automated via ${shipResult.courierName}. AWB: ${shipResult.awbNumber}` });
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
                }
            } catch (shipErr) { console.error('❌ Nimbus Automation Exception:', shipErr); }
        }

        if (newOrder.partnerRef) {
            await processPartnerSale(newOrder, newOrder.partnerRef);
        }

        // 🕒 Schedule Delayed WhatsApp Order Confirmation (2 min delay)
        try {
            await jobService.schedule(user._id, 'OrderPlaced', 2, { orderId: newOrder.orderId });
            await jobService.cancel(user._id, 'AbandonedCart');
            await Cart.findOneAndUpdate({ userId: user._id }, { isPurchased: true, remindersSent: 0 });
        } catch (err) {
            console.error('Job Scheduling Error (Cashfree):', err);
        }

        res.status(201).json({ success: true, order: newOrder, message: 'Payment verified and order placed' });

    } catch (error) {
        console.error('Cashfree Verification Error:', error);
        res.status(500).json({ message: 'Payment verification failed' });
    }
});

// Cashfree Webhook Handler (notify_url)
router.post('/cashfree-notify', async (req, res) => {
    try {
        const { order_id, order_status } = req.body;
        console.log(`📡 Cashfree Webhook Received for Order: ${order_id}, Status: ${order_status}`);

        if (order_status === 'PAID' || order_status === 'SUCCESS') {
            const existingOrder = await Order.findOne({ cashfreeOrderId: order_id });
            if (!existingOrder) {
                console.log(`🔄 Webhook triggering background fulfillment for ${order_id}...`);
                // Note: Background fulfillment logic should ideally be abstracted to a service
                // For now, this acknowledges the payment to Cashfree
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).send('Error');
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
                const cleanedCode = (couponCode || '').trim().toUpperCase();
                const coupon = await Coupon.findOne({ code: cleanedCode, isActive: true });
                if (coupon) {
                    const isExpired = coupon.expiryDate && new Date(coupon.expiryDate) < new Date();
                    const isUnderMin = subtotal < (coupon.minOrder || 0); // Corrected to subtotal
                    const isLimitReached = (coupon.usedCount || 0) >= (coupon.usageLimit || 1000);

                    if (!isExpired && !isLimitReached) {
                        if (coupon.type === 'Percentage') discount = (subtotal * (coupon.value || 0)) / 100;
                        else discount = (coupon.value || 0);
                        
                        discount = Math.min(discount, subtotal);
                        
                        // Increment used count for COD
                        coupon.usedCount = (coupon.usedCount || 0) + 1;
                        await coupon.save();

                        if (coupon.isPartnerCoupon && coupon.partnerId) {
                            pRef = {
                                partnerId: coupon.partnerId.toString(),
                                partnerName: coupon.partnerName || 'Unknown Partner',
                                couponCode: coupon.code,
                                commissionPercent: (coupon.commissionPercent || 0),
                                commissionAmount: Math.round((subtotal * (coupon.commissionPercent || 0)) / 100),
                                commissionPaid: false
                            };
                        }
                    }
                }
            } catch (err) { console.error('COD Coupon Error:', err); }
        }

        // SHIPPING & COD CHARGES Logic (Prioritizing Frontend Calculation for Parity)
        const shippingCharge = req.body.shippingCharge || 42.48; 
        const codCharge = req.body.codCharge || (36.58 + (subtotal * 0.0224));

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
                address: {
                    house: customer.street || customer.house || '',
                    area: customer.area || '',
                    city: customer.city || 'Unknown',
                    state: customer.state || '',
                    pincode: customer.pincode || customer.zip || '000000',
                    country: customer.country || 'India'
                },
                city: customer.city || 'Unknown',
                zip: customer.pincode || customer.zip || '000000'
            },
            items: processedItems.map(item => ({
                productId: item.productId,
                title: item.title,
                price: Number(item.price),
                quantity: Number(item.quantity),
                type: item.type
            })),
            totalAmount: finalAmount,
            shippingCharges: Number(shippingCharge) || 0,
            codCharges: Number(codCharge) || 0,
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

                const cleanPhone = (customer.phone || '0000000000').toString().replace(/\D/g, '').slice(-10);

                const addressForShipping = {
                    fullName: customer.fullName || customer.name,
                    email: customer.email,
                    phone: cleanPhone,
                    house: customer.street || customer.house,
                    area: customer.area || '',
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

        // 🕒 Schedule Delayed WhatsApp Order Confirmation (2 min delay)
        try {
            await jobService.schedule(newOrder.userId || newOrder.customer.email, 'OrderPlaced', 2, { orderId: newOrder.orderId });
            if (newOrder.userId) {
                await jobService.cancel(newOrder.userId, 'AbandonedCart');
                await Cart.findOneAndUpdate({ userId: newOrder.userId }, { isPurchased: true, remindersSent: 0 });
            }
        } catch (err) {
            console.error('Job Scheduling Error (COD):', err);
        }

        res.status(201).json({ success: true, order: newOrder });

    } catch (error) {
        console.error('COD Place Error:', error);
        res.status(500).json({ message: 'Error placing COD order: ' + error.message, stack: error.stack });
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
                    const searchId = (userId || '').toString();
                    console.log(`📦 [FULFILLMENT] Unlocking ${digitalItems.length} items for ${order.customer.email} (Status change)`);

                    let library = await DigitalLibrary.findOne({ 
                        $or: [{ userId: userId }, { userId: searchId }]
                    });

                    if (!library) {
                        console.log(`✨ [FULFILLMENT] Creating NEW library record...`);
                        library = new DigitalLibrary({ userId: userId, items: [] });
                    }
                    if (!library.items) library.items = [];

                    digitalItems.forEach(di => {
                        const pidStr = di.productId.toString();
                        const alreadyOwned = library.items.some(li => (li.productId || '').toString() === pidStr);
                        
                        if (!alreadyOwned) {
                            library.items.push(di);
                            console.log(`✅ [FULFILLMENT] Added to Library: ${di.title}`);
                        }
                    });

                    library.updatedAt = new Date().toISOString();
                    await library.save();
                    console.log(`💾 [FULFILLMENT] Library updated for user ID: ${searchId}`);
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
                // 📱 WhatsApp Status Notifications
                try {
                    if (status === 'Shipped') {
                        await whatsappService.sendOrderShipped(order);
                    } else if (status === 'Delivered') {
                        await whatsappService.sendOrderDelivered(order);
                    } else if (status === 'Cancelled') {
                        await whatsappService.sendOrderCancelled(order);
                    }
                } catch (wErr) {
                    console.error('WhatsApp notify error:', wErr);
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

        // Attempt to sync status from NimbusPost if AWB exists and order is not finalized
        const activeStatuses = ['Processing', 'Packed', 'Shipped', 'Out for Delivery', 'Pending', 'Cancelled'];
        if (orderObj.awbNumber && activeStatuses.includes(orderObj.status)) {
            try {
                const nimbusPostService = require('../services/nimbusPostService');
                const tracking = await nimbusPostService.trackShipment(orderObj.awbNumber);
                if (tracking && tracking.status) {
                    const nStatusRaw = tracking.data?.status_name || tracking.data?.status || tracking.data?.history?.[0]?.status_name || '';
                    const nStatus = nStatusRaw.toLowerCase();
                    
                    let newStatus = null;
                    if (nStatus.includes('cancel')) newStatus = 'Cancelled';
                    else if (nStatus.includes('deliver')) newStatus = 'Delivered';
                    else if (nStatus.includes('return') || nStatus.includes('rtv') || nStatus.includes('rto')) newStatus = 'Returned';
                    else if (nStatus.includes('pick') || nStatus.includes('transit') || nStatus.includes('shipped') || nStatus.includes('dispatch') || nStatus.includes('hub')) newStatus = 'Shipped';
                    else if (nStatus.includes('process') || nStatus.includes('pack')) newStatus = 'Processing';

                    if (newStatus && newStatus !== orderObj.status) {
                        console.log(`🔄 Track Sync: Order ${orderObj.orderId} status ${orderObj.status} -> ${newStatus}`);
                        orderObj.status = newStatus; // Update POJO for response
                        // Also update the actual order in DB
                        order.status = newStatus;
                        order.timeline.push({ 
                            status: newStatus, 
                            note: `Status synced from NimbusPost during track (${nStatus})`,
                            timestamp: new Date()
                        });
                        await order.save();
                    }
                }
            } catch (syncErr) {
                console.warn(`⚠️ Track sync failed for ${orderObj.orderId}:`, syncErr.message);
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
        const mongoUser = await User.findById(user._id);
        if (mongoUser) {
            if (!mongoUser.purchasedProducts) mongoUser.purchasedProducts = [];
            const isAlreadyPurchased = mongoUser.purchasedProducts.some(id => id.toString() === prodIdStr);
            if (!isAlreadyPurchased) {
                mongoUser.purchasedProducts.push(prodIdStr);
            }
            mongoUser.markModified('purchasedProducts');
            await mongoUser.save();
        }

        // 4. Update Digital Library
        let library = await DigitalLibrary.findOne({ userId: user._id.toString() });
        if (!library) {
            library = new DigitalLibrary({
                userId: user._id.toString(),
                items: [{
                    productId: product._id.toString(),
                    title: product.title,
                    type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                    thumbnail: product.thumbnail || 'img/vol1-cover.png',
                    filePath: product.filePath || '',
                    purchasedAt: new Date().toISOString()
                }]
            });
        } else {
            if (!library.items) library.items = [];
            const alreadyInLib = library.items.some(i => (i.productId || '').toString() === product._id.toString());
            if (!alreadyInLib) {
                library.items.push({
                    productId: product._id.toString(),
                    title: product.title,
                    type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                    thumbnail: product.thumbnail || 'img/vol1-cover.png',
                    filePath: product.filePath || '',
                    purchasedAt: new Date().toISOString()
                });
            }
        }
        await library.save();

        // 🔔 Add Purchase Notification (Test Mode)
        try {
            const mongoUser2 = await User.findById(user._id);
            if (mongoUser2) {
                if (!mongoUser2.notifications) mongoUser2.notifications = [];
                mongoUser2.notifications.unshift({
                    _id: 'purchase-test-' + Date.now(),
                    title: 'Item Unlocked! 🔓',
                    message: `"${product.title}" has been successfully added to your library.`,
                    type: 'Order',
                    link: 'profile.html?tab=library',
                    isRead: false,
                    createdAt: new Date().toISOString()
                });
                mongoUser2.markModified('notifications');
                await mongoUser2.save();
            }
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


// ============================================================
// NIMBUSPOST WEBHOOK (Automatic Status Updates)
// ============================================================
router.post('/nimbus-webhook', async (req, res) => {
    try {
        const { awb, status_name } = req.body;
        console.log(`📡 NimbusPost Webhook: AWB ${awb}, Status ${status_name}`);
        
        if (awb) {
            const order = await Order.findOne({ awbNumber: awb });
            if (order) {
                const lowerStatus = (status_name || '').toLowerCase();
                let newStatus = null;
                if (lowerStatus.includes('cancel')) newStatus = 'Cancelled';
                else if (lowerStatus.includes('deliver')) newStatus = 'Delivered';
                else if (lowerStatus.includes('return')) newStatus = 'Returned';
                else if (lowerStatus.includes('pick') || lowerStatus.includes('transit') || lowerStatus.includes('shipped')) newStatus = 'Shipped';

                if (newStatus && newStatus !== order.status) {
                    console.log(`✅ Webhook Sync: Order ${order.orderId} -> ${newStatus}`);
                    order.status = newStatus;
                    order.timeline.push({ 
                        status: newStatus, 
                        note: `Status updated automatically via NimbusPost Webhook (${status_name})`,
                        timestamp: new Date()
                    });
                    await order.save();

                    // 📱 WhatsApp Notify via Webhook Sync
                    try {
                        if (newStatus === 'Shipped') await whatsappService.sendOrderShipped(order);
                        else if (newStatus === 'Delivered') await whatsappService.sendOrderDelivered(order);
                        else if (newStatus === 'Cancelled') await whatsappService.sendOrderCancelled(order);
                    } catch (e) {}
                }
            }
        }
        res.status(200).send('OK');
    } catch (err) {
        console.error('❌ Webhook Error:', err);
        res.status(500).send('Error');
    }
});


// ============================================================
// SYNC ALL ORDERS STATUS (NimbusPost)
// ============================================================
router.get('/sync-all', protect, async (req, res) => {
    try {
        const nimbusPostService = require('../services/nimbusPostService');
        const query = {
            $or: [
                { userId: req.user._id },
                { "customer.email": new RegExp('^' + req.user.email + '$', 'i') }
            ]
        };
        const orders = await Order.find(query);
        let updatedCount = 0;

        for (const order of orders) {
            // Only sync active/pending/cancelled shipments (to ensure cancellation sync)
            const activeStatuses = ['Processing', 'Packed', 'Shipped', 'Out for Delivery', 'Pending', 'Cancelled'];
            if (order.awbNumber && activeStatuses.includes(order.status)) {
                try {
                    const tracking = await nimbusPostService.trackShipment(order.awbNumber);
                    if (tracking && tracking.status) {
                        // Nimbus status mapping
                        // Use top-level status_name if available, fallback to status, then history[0]
                        const nStatusRaw = tracking.data?.status_name || tracking.data?.status || tracking.data?.history?.[0]?.status_name || '';
                        const nStatus = nStatusRaw.toLowerCase();
                        
                        let newStatus = null;
                        if (nStatus.includes('cancel')) newStatus = 'Cancelled';
                        else if (nStatus.includes('deliver')) newStatus = 'Delivered';
                        else if (nStatus.includes('return') || nStatus.includes('rtv') || nStatus.includes('rto')) newStatus = 'Returned';
                        else if (nStatus.includes('pick') || nStatus.includes('transit') || nStatus.includes('shipped') || nStatus.includes('dispatch') || nStatus.includes('hub')) newStatus = 'Shipped';
                        else if (nStatus.includes('process') || nStatus.includes('pack')) newStatus = 'Processing';

                        if (newStatus && newStatus !== order.status) {
                            console.log(`🔄 Sync: Order ${order.orderId} status ${order.status} -> ${newStatus}`);
                            order.status = newStatus;
                            order.timeline.push({ 
                                status: newStatus, 
                                note: `Status synced from NimbusPost (${nStatus})`,
                                timestamp: new Date()
                            });
                            await order.save();
                            updatedCount++;

                            // 📱 WhatsApp Notify via Sync All
                            try {
                                if (newStatus === 'Shipped') await whatsappService.sendOrderShipped(order);
                                else if (newStatus === 'Delivered') await whatsappService.sendOrderDelivered(order);
                                else if (newStatus === 'Cancelled') await whatsappService.sendOrderCancelled(order);
                            } catch (e) {}
                        }
                    }
                } catch (err) {
                    console.warn(`⚠️ Sync failed for ${order.orderId}:`, err.message);
                }
            }
        }
        res.json({ success: true, updatedCount });
    } catch (error) {
        console.error('Sync Error:', error);
        res.status(500).json({ message: 'Sync failed' });
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

        // Already cancelled? (Only block if totally finalized, but allow retry for Nimbus sync)
        if (order.status === 'Cancelled' && !order.awbNumber) {
            return res.status(400).json({ message: 'Order is already cancelled.' });
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

        // 📱 WhatsApp Cancellation Notify
        try {
            await whatsappService.sendOrderCancelled(order, reason);
        } catch (wErr) {
            console.error('WhatsApp cancel error:', wErr);
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

// DELETE AN ORDER (Admin or Owner for cancelled orders)
router.delete('/:id', protect, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Security check: Only admin or owner
        const isAdmin = req.user.role === 'admin' || req.user.email?.toLowerCase() === 'admin@uwo24.com';
        if (order.userId !== req.user._id && !isAdmin) {
            return res.status(403).json({ message: 'Unauthorized action' });
        }

        // Restriction: Only delete cancelled/failed/pending orders unless admin
        const deletableStatuses = ['Cancelled', 'Failed', 'Pending', 'Payment Failed'];
        if (!deletableStatuses.includes(order.status) && !isAdmin) {
             return res.status(400).json({ message: 'Active orders cannot be deleted. Cancel them first.' });
        }

        await Order.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Order record deleted successfully' });
    } catch (error) {
        console.error('Delete Order Error:', error);
        res.status(500).json({ message: 'Error deleting order record' });
    }
});

// ── RAZORPAY ────────────────────────────────────────────────────────────────

// Create Razorpay Order
router.post('/razorpay', protect, async (req, res) => {
    try {
        const { amount, customerName, customerEmail, customerPhone } = req.body;
        if (!amount) return res.status(400).json({ message: 'Amount is required' });

        const receipt = `EFV-RZP-${Date.now()}`;
        const rzpOrder = await createRazorpayOrder({
            amount : Number(amount),   // ₹ amount – util converts to paise
            receipt: receipt,
            notes  : {
                customerName : customerName  || req.user.name,
                customerEmail: customerEmail || req.user.email,
                customerPhone: customerPhone || req.user.phone || ''
            }
        });

        res.json({
            rzpOrderId: rzpOrder.id,
            amount    : rzpOrder.amount,   // paise
            currency  : rzpOrder.currency,
            receipt   : rzpOrder.receipt
        });
    } catch (error) {
        console.error('Razorpay Create Order Error:', error);
        res.status(500).json({
            message: 'Failed to create Razorpay order',
            error  : error.error ? error.error : error.message
        });
    }
});

// Verify Razorpay Payment & Fulfill Order
router.post('/verify-razorpay', protect, async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            customer: directCustomer,
            items   : directItems,
            couponCode,
            shippingCharge,
            codCharge
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ message: 'Missing Razorpay payment fields' });
        }

        // 1. Verify signature
        const isValid = verifyRazorpaySignature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        );

        if (!isValid) {
            console.warn(`⚠️ Razorpay Signature Mismatch for order: ${razorpay_order_id}`);
            return res.status(400).json({ message: 'Payment signature verification failed' });
        }

        // 2. Prevent duplicate fulfillment
        const existingOrder = await Order.findOne({ razorpayOrderId: razorpay_order_id });
        if (existingOrder) {
            return res.status(200).json({
                success: true,
                order  : existingOrder,
                message: 'Order was already processed successfully'
            });
        }

        // 3. Extra server-side check: fetch payment status from Razorpay
        const payment = await fetchRazorpayPayment(razorpay_payment_id);
        if (payment.status !== 'captured') {
            return res.status(400).json({ message: `Payment not captured. Status: ${payment.status}` });
        }

        console.log(`✅ Razorpay Payment Verified: ${razorpay_payment_id} for order ${razorpay_order_id}`);

        // 4. Build address & items
        const user = await User.findOne({ email: req.user.email });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const address = directCustomer ? {
            fullName: directCustomer.name,
            email   : directCustomer.email,
            phone   : directCustomer.phone    || user.phone || '0000000000',
            house   : directCustomer.street   || directCustomer.address || '',
            area    : directCustomer.area     || '',
            city    : directCustomer.city     || 'Unknown',
            state   : directCustomer.state    || '',
            pincode : directCustomer.pincode  || '000000',
            country : directCustomer.country  || 'India'
        } : null;

        if (!address) return res.status(400).json({ message: 'Shipping address missing' });

        const finalItems = directItems || [];
        if (finalItems.length === 0) return res.status(400).json({ message: 'No items in order' });

        let totalAmount = 0;
        const orderItems = [];

        for (const item of finalItems) {
            const product = await Product.findById(item.id || item.productId);
            if (!product) continue;
            const sellingPrice = product.price * (1 - (product.discount || 0) / 100);
            totalAmount += sellingPrice * item.quantity;
            orderItems.push({
                productId: product._id,
                title    : product.title,
                type     : product.type,
                price    : sellingPrice,
                quantity : item.quantity
            });
        }

        if (orderItems.length === 0) return res.status(400).json({ message: 'No valid products found' });

        // 5. Coupon logic (mirrors Cashfree flow)
        let discountAmount = 0;
        let partnerRef = null;
        let appliedCouponCode = '';

        if (couponCode) {
            const cleanedCode = (couponCode || '').trim().toUpperCase();
            console.log(`🔍 [VERIFY-RZP] Checking coupon: "${cleanedCode}"`);
            const coupon = await Coupon.findOne({ code: cleanedCode, isActive: true });
            if (coupon) {
                console.log(`✅ [VERIFY-RZP] Coupon found: ${coupon.code}. isPartner: ${coupon.isPartnerCoupon}`);
                const isExpired       = coupon.expiryDate && new Date(coupon.expiryDate) < new Date();
                const isUnderMin      = totalAmount < (coupon.minOrder || 0);
                const isLimitReached  = (coupon.usedCount || 0) >= (coupon.usageLimit || 1000);

                if (!isExpired && !isUnderMin && !isLimitReached) {
                    discountAmount = coupon.type === 'Percentage'
                        ? (totalAmount * (coupon.value || 0)) / 100
                        : (coupon.value || 0);
                    discountAmount    = Math.min(discountAmount, totalAmount);
                    appliedCouponCode = coupon.code;
                    
                    // Safe increment
                    coupon.usedCount = (coupon.usedCount || 0) + 1;
                    await coupon.save();

                    if (coupon.isPartnerCoupon && coupon.partnerId) {
                        partnerRef = {
                            partnerId       : coupon.partnerId.toString(),
                            partnerName     : coupon.partnerName || 'Unknown Partner',
                            couponCode      : coupon.code,
                            commissionPercent: (coupon.commissionPercent || 0),
                            commissionAmount : Math.round((totalAmount * (coupon.commissionPercent || 0)) / 100),
                            commissionPaid  : false
                        };
                        console.log(`💰 [VERIFY-RZP] Partner Ref Attached: ${partnerRef.partnerName} (${partnerRef.partnerId})`);
                    }
                } else {
                    console.log(`⚠️ [VERIFY-RZP] Coupon ${coupon.code} failed checks: Expired=${isExpired}, UnderMin=${isUnderMin}, LimitReached=${isLimitReached}`);
                }
            } else {
                console.log(`❌ [VERIFY-RZP] Coupon "${cleanedCode}" not found or inactive`);
            }
        }

        const sCharge = Number(shippingCharge) || 0;
        const cCharge = Number(codCharge)      || 0;
        
        // Items Subtotal Calculation
        const itemsSubtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        // TRUST THE PAYMENT GATEWAY: The amount the user actually paid
        const actualPaidAmount = Math.round(payment.amount / 100); 
        
        // Calculate Tax (18% GST implied by UI)
        const taxableVal = actualPaidAmount / 1.18;
        const calcTax = actualPaidAmount - taxableVal;

        // Finalize Discount: Difference between theoretical total and actual paid
        // theories = itemsSubtotal + sCharge + cCharge (we assume sCharge/cCharge were already part of the RZP order)
        let totalDiscount = 0;
        if (appliedCouponCode) {
            totalDiscount = (itemsSubtotal + sCharge) - actualPaidAmount;
            if (totalDiscount < 0) totalDiscount = 0;
        }

        const isPurelyDigital = orderItems.every(i => i.type === 'EBOOK' || i.type === 'AUDIOBOOK');

        // 6. Create Order record
        const newOrder = await Order.create({
            orderId         : 'ORD-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000),
            userId          : user._id,
            customer: {
                name   : address.fullName || user.name,
                email  : address.email    || user.email,
                phone  : address.phone    || user.phone || '0000000000',
                address: address,
                city   : address.city     || '',
                zip    : address.pincode  || ''
            },
            items           : orderItems,
            subtotal        : Math.round(itemsSubtotal),
            taxAmount       : Math.round(calcTax),
            totalAmount     : actualPaidAmount,
            shippingCharges : sCharge,
            codCharges      : cCharge,
            discountAmount  : Math.round(totalDiscount),
            couponCode      : appliedCouponCode,
            partnerRef      : partnerRef,
            paymentMethod   : 'Razorpay',
            paymentStatus   : 'Paid',
            status          : isPurelyDigital ? 'Completed (Digital)' : 'Processing',
            orderType       : isPurelyDigital ? 'digital' : 'physical',
            razorpayOrderId : razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            timeline        : [{
                status: isPurelyDigital ? 'Completed (Digital)' : 'Paid',
                note  : isPurelyDigital
                    ? 'Digital Product Purchased & Unlocked'
                    : `Payment verified via Razorpay (${razorpay_payment_id})`
            }]
        });

        // 7. Unlock Digital Items (ROBUST FULFILLMENT)
        const digitalItems = [];
        for (const item of orderItems) {
            const iType = (item.type || '').toUpperCase();
            if (iType === 'EBOOK' || iType === 'AUDIOBOOK') {
                console.log(`🔑 [UNLOCK] Processing Digital Item: ${item.title} (${item.productId})`);
                
                let product = await Product.findById(item.productId);
                if (!product) {
                    // Fallback to title matching if ID is different (common in seed data)
                    const cleanTitle = (item.title || '').replace(/\(.*\)/, '').replace(/[™®]/g, '').trim();
                    product = await Product.findOne({ title: new RegExp(cleanTitle, 'i') });
                }

                if (product) {
                    digitalItems.push({
                        productId   : product._id,
                        title       : product.title,
                        type        : (product.type || 'EBOOK').toUpperCase() === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                        thumbnail   : product.thumbnail,
                        filePath    : product.filePath,
                        purchasedAt : new Date(),
                        orderId     : newOrder.orderId,
                        accessStatus: 'active'
                    });
                } else {
                    console.warn(`⚠️ [UNLOCK] Product not found in marketplace for: ${item.title}`);
                }
            }
        }

        if (digitalItems.length > 0) {
            // Standardize UserID lookup (support both ObjectId and String)
            const resolvedUserId = user._id || user.id;
            const searchId = (resolvedUserId || '').toString();
            
            console.log(`📦 [UNLOCK] Unlocking ${digitalItems.length} items for ${user.email} (UserID: ${searchId})`);

            let library = await DigitalLibrary.findOne({ 
                $or: [{ userId: resolvedUserId }, { userId: searchId }]
            });

            if (!library) {
                console.log(`✨ [UNLOCK] Creating NEW library record for ${user.email}...`);
                library = new DigitalLibrary({ userId: resolvedUserId, items: [] });
            }
            if (!library.items) library.items = [];

            digitalItems.forEach(di => {
                const pidStr = di.productId.toString();
                const alreadyOwned = library.items.some(li => (li.productId || '').toString() === pidStr);
                
                if (!alreadyOwned) {
                    library.items.push(di);
                    console.log(`✅ [UNLOCK] Added to Library: ${di.title}`);
                }
            });

            library.updatedAt = new Date().toISOString();
            await library.save();
            console.log(`💾 [UNLOCK] Successfully saved library for ${user.email}`);
        }

        // 8. Notification
        try {
            if (!user.notifications) user.notifications = [];
            user.notifications.unshift({
                _id    : 'purchase-rzp-' + Date.now(),
                title  : isPurelyDigital ? 'Content Unlocked! 📖' : 'Purchase Successful! 🎉',
                message: isPurelyDigital
                    ? `Your digital products from order #${newOrder.orderId} are now available in My Library.`
                    : `Thank you for your order ${newOrder.orderId}. Your items are being processed.`,
                type   : 'Order',
                link   : isPurelyDigital ? 'profile.html?tab=library' : 'profile.html?tab=orders',
                isRead : false,
                createdAt: new Date().toISOString()
            });
            user.updatedAt = new Date().toISOString();
            await user.save();
        } catch (noteErr) {}

        // 9. Auto-Shipping for Physical Items
        const physicalItems = orderItems.filter(i => i.type === 'HARDCOVER' || i.type === 'PAPERBACK');
        if (physicalItems.length > 0) {
            try {
                const nimbusPostService = require('../services/nimbusPostService');
                const { Shipment } = require('../models');
                const shipResult = await nimbusPostService.automateShipping(newOrder, address, physicalItems, 'prepaid');

                if (shipResult.status) {
                    newOrder.shipmentId   = shipResult.shipmentId;
                    newOrder.awbNumber    = shipResult.awbNumber;
                    newOrder.courierName  = shipResult.courierName;
                    newOrder.trackingLink = shipResult.trackingLink;
                    newOrder.labelUrl     = shipResult.labelUrl;
                    newOrder.timeline.push({ status: 'Shipped', note: `Shipment automated via ${shipResult.courierName}. AWB: ${shipResult.awbNumber}` });
                    await newOrder.save();
                    await Shipment.create({
                        orderId       : newOrder._id.toString(),
                        shipmentId    : shipResult.shipmentId,
                        awbNumber     : shipResult.awbNumber,
                        courierName   : shipResult.courierName,
                        labelUrl      : shipResult.labelUrl,
                        trackingLink  : shipResult.trackingLink,
                        shippingStatus: 'Processing'
                    });
                }
            } catch (shipErr) { console.error('❌ Nimbus Automation for Razorpay order failed:', shipErr); }
        }

        if (newOrder.partnerRef) {
            await processPartnerSale(newOrder, newOrder.partnerRef);
        }

        // 🕒 Schedule Delayed WhatsApp Order Confirmation (2 min delay)
        try {
            await jobService.schedule(newOrder.userId, 'OrderPlaced', 2, { orderId: newOrder.orderId });
            await jobService.cancel(newOrder.userId, 'AbandonedCart');
            await Cart.findOneAndUpdate({ userId: newOrder.userId }, { isPurchased: true, remindersSent: 0 });
        } catch (err) {
            console.error('Job Scheduling Error (Razorpay):', err);
        }

        res.status(201).json({ success: true, order: newOrder, message: 'Payment verified and order placed' });

    } catch (error) {
        console.error('Razorpay Verify Error:', error);
        res.status(500).json({ message: 'Payment verification failed' });
    }
});

/**
 * @route   GET /api/orders/:id/invoice
 * @desc    Generate PDF Invoice for an order
 * @access  Private
 */
router.get('/:id/invoice', protect, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Security check: Only admin or owner
        const isAdmin = req.user.role === 'admin' || req.user.email?.toLowerCase() === 'admin@uwo24.com';
        const isOwner = order.userId?.toString() === req.user._id?.toString() || 
                       order.customer?.email?.toLowerCase() === req.user.email?.toLowerCase();
        
        if (!isAdmin && !isOwner) return res.status(403).json({ message: 'Unauthorized' });

        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ margin: 50, autoFirstPage: true });

        // Stream PDF to Response
        const filename = `EFV_Invoice_${order.orderId}.pdf`;
        res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        // --- PDF DESIGN ---
        const EFV_GOLD = '#D4AF37';
        const DARK = '#141414';

        // Header Background
        doc.rect(0, 0, doc.page.width, 100).fill(DARK);
        
        // Brand Logo
        doc.fillColor(EFV_GOLD).font('Helvetica-Bold').fontSize(32).text('EFV', 50, 30);
        doc.fontSize(12).font('Helvetica').text('OFFICIAL TAX INVOICE', 50, 65);
        
        // Order Info (Right Aligned)
        const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB');
        doc.fillColor('#FFFFFF').fontSize(9);
        doc.text(`Invoice No: INV-${(order.orderId || '').split('-').pop()}`, 400, 30, { align: 'right' });
        doc.text(`Order ID: #${order.orderId || 'N/A'}`, 400, 45, { align: 'right' });
        doc.text(`Date: ${dateStr}`, 400, 60, { align: 'right' });
        
        // Customers Safety
        const customer = order.customer || {};
        const items = order.items || [];

        // --- MERCHANT & CUSTOMER DETAILS ---
        doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold').text('SOLD BY:', 50, 120);
        doc.font('Helvetica').fontSize(9)
           .text('EFV - Educational Future Vision', 50, 135)
           .text('Madhya Pradesh, India', 50, 150)
           .text('GSTIN: 23EFVPA0000Z1Z1', 50, 165)
           .text('Support: admin@uwo24.com', 50, 180);

        doc.font('Helvetica-Bold').text('BILL TO:', 350, 120);
        doc.font('Helvetica').fontSize(9)
           .text(String(customer.name || 'Valued Customer'), 350, 135)
           .text(String(customer.city || 'N/A'), 350, 150)
           .text(String(customer.zip || ''), 350, 165)
           .text(`Contact: ${customer.phone || 'N/A'}`, 350, 180);

        // --- ITEMS TABLE ---
        const tableTop = 230;
        doc.rect(50, tableTop, 500, 20).fill('#F5F5F5');
        doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8)
           .text('ITEM', 60, tableTop + 6)
           .text('QTY', 280, tableTop + 6)
           .text('PRICE', 350, tableTop + 6)
           .text('TAX', 420, tableTop + 6)
           .text('TOTAL', 490, tableTop + 6);

        let rowY = tableTop + 30;
        items.forEach(item => {
            const title = String(item.title || 'Product').substring(0, 40);
            const qty = Number(item.quantity || 0);
            const price = Number(item.price || 0);
            doc.font('Helvetica').fillColor('#333333').fontSize(8)
               .text(title, 60, rowY, { width: 210 })
               .text(qty.toString(), 280, rowY)
               .text(`INR ${price.toFixed(2)}`, 350, rowY)
               .text('18%', 420, rowY)
               .text(`INR ${(price * qty).toFixed(2)}`, 490, rowY);
            rowY += 25;
        });

        // --- TOTALS SECTION ---
        rowY += 20;
        doc.moveTo(350, rowY).lineTo(550, rowY).stroke('#EEEEEE');
        rowY += 15;

        const codCharges = Number(order.codCharges || 0);
        const subtotal = Number(order.subtotal || items.reduce((s, i) => s + (Number(i.price || 0) * Number(i.quantity || 0)), 0));
        const shipping = Number(order.shippingCharges || 0);
        const discount = Number(order.discountAmount || 0);
        const total    = Number(order.totalAmount || 0);
        const tax      = Number(order.taxAmount || (total - (total / 1.18)));

        const renderRow = (label, value, isBold = false, isGlow = false) => {
            if (isGlow) {
                doc.rect(340, rowY - 5, 210, 20).fill(DARK);
                doc.fillColor(EFV_GOLD);
            } else {
                doc.fillColor('#666666');
            }
            doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(isBold ? 11 : 9);
            doc.text(label, 350, rowY);
            doc.text(`INR ${Number(value || 0).toFixed(2)}`, 490, rowY, { align: 'right', width: 60 });
            rowY += 20;
        };

        renderRow('Book Price:', subtotal);
        if (shipping > 0) renderRow('Shipping:', shipping);
        if (codCharges > 0) renderRow('COD Charges:', codCharges);
        
        if (discount > 0) {
            const discLabel = order.couponCode ? `Discount (Coupon: ${order.couponCode}):` : 'Discount:';
            renderRow(discLabel, -discount);
        }
        
        renderRow('GST (18%):', tax);
        rowY += 10;
        renderRow('GRAND TOTAL:', total, true, true);

        // Footer
        doc.fillColor('#999999').fontSize(8).font('Helvetica-Oblique')
           .text('Terms: This is a system-generated tax invoice. Digital products are non-refundable.', 50, 700, { align: 'center' });
        doc.fillColor(EFV_GOLD).font('Helvetica-Bold').fontSize(10)
           .text('THANK YOU FOR SHOPPING AT EFV', 50, 720, { align: 'center' });

        doc.end();

    } catch (e) {
        console.error('Invoice Route Error:', e);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Failed to generate invoice' });
        }
    }
});

module.exports = router;

module.exports = router;

