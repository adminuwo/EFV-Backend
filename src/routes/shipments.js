const express = require('express');
const router = express.Router();
const { Shipment, Order } = require('../models');
const adminAuth = require('../middleware/adminAuth');

const nimbusPostService = require('../services/nimbusPostService');
const { protect } = require('../middleware/auth');

// Get all shipments (Admin Only)
router.get('/', adminAuth, async (req, res) => {
    try {
        const shipments = await Shipment.find().sort({ createdAt: -1 });
        res.json(shipments);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching shipments' });
    }
});

/**
 * @route   GET /api/shipments/track/:awb
 * @desc    Track a shipment with NimbusPost (LIVE DATA)
 * @access  Private (Logged in users only)
 */
router.get('/track/:awb', protect, async (req, res) => {
    try {
        const { awb } = req.params;
        if (!awb || awb === 'undefined') {
            return res.status(400).json({ status: false, message: 'Invalid AWB number' });
        }

        const trackingData = await nimbusPostService.trackShipment(awb);
        res.json(trackingData);
    } catch (error) {
        console.error('Nimbus Tracking Route Error:', error.message);
        res.status(500).json({ status: false, message: 'Unable to fetch live tracking. Please try later.' });
    }
});

// Update shipment status
router.put('/:id', adminAuth, async (req, res) => {
    try {
        const shipment = await Shipment.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!shipment) return res.status(404).json({ message: 'Shipment not found' });
        res.json(shipment);
    } catch (error) {
        res.status(400).json({ message: 'Error updating shipment' });
    }
});

/**
 * @route   POST /api/shipments/create
 * @desc    Create a shipment for an order (NimbusPost)
 * @access  Admin Only
 */
router.post('/create', adminAuth, async (req, res) => {
    try {
        const { orderId } = req.body;
        const order = await Order.findById(orderId).populate('items.productId');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const c = order.customer || {};
        // Deep address parsing — handles both flat and nested address structures
        const addr = (typeof c.address === 'object' && c.address !== null) ? c.address : {};

        const city = c.city || addr.city || addr.district || '';
        const state = c.state || addr.state || '';
        const pincode = c.zip || addr.pincode || addr.zip || '';
        const phone = c.phone || addr.phone || '';

        const addressLine = [
            addr.house, addr.street, addr.area, addr.landmark, addr.fullAddress,
            typeof c.address === 'string' ? c.address : null
        ].filter(Boolean).join(', ') || 'No address provided';

        // --- Validate mandatory fields BEFORE hitting Nimbus ---
        const missing = [];
        if (!c.name) missing.push('Consignee name');
        if (!addressLine || addressLine === 'No address provided') missing.push('Consignee Address');
        if (!city) missing.push('Consignee City');
        if (!state) missing.push('Consignee State');
        if (!pincode || pincode === '000000') missing.push('Consignee Pincode');
        if (!phone) missing.push('Consignee Phone');
        if (!order.totalAmount) missing.push('Order Total');

        if (missing.length > 0) {
            return res.status(400).json({
                message: `Cannot create shipment. Missing: ${missing.join(', ')}. Please check the order address.`
            });
        }

        // Prepare NimbusPost Payload (Confirmed working format)
        const payload = {
            order_number: order.orderId,

            consignee: {
                name: c.name,
                email: c.email || '',
                phone: phone,
                address: addressLine,
                city: city,
                state: state,
                pincode: pincode,
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

            order_items: order.items.map(item => ({
                name: item.title,
                qty: item.quantity,
                price: item.price,
                sku: item.productId?.title || item.title
            })),
            payment_type: (order.paymentMethod || '').toLowerCase() === 'cod' ? 'cod' : 'prepaid',
            order_amount: order.totalAmount,
            weight: order.items.reduce((sum, item) => sum + (item.productId?.weight || 500) * item.quantity, 0),
            sub_weight: 0,
            length: 10, breadth: 10, height: 10,
            support_email: "sreshthi+3296@uwo24.com",
            support_phone: "9798780000"
        };

        console.log('📦 Nimbus Shipment Payload:', JSON.stringify(payload, null, 2));
        const result = await nimbusPostService.createShipment(payload);
        console.log('📄 Nimbus API Result:', JSON.stringify(result, null, 2));

        if (result.status && result.data) {
            // Create shipment record
            const newShipment = await Shipment.create({
                orderId: order._id,
                shipmentId: result.data.shipment_id || '',
                awbNumber: result.data.awb_number || '',
                courierName: result.data.courier_name || 'NimbusPost',
                shippingStatus: 'Processing',
                trackingLink: result.data.tracking_url || ''
            });

            // Update Order
            order.status = 'Processing';
            order.shipmentId = newShipment.shipmentId;
            order.timeline.push({ status: 'Processing', note: 'Shipment created via NimbusPost' });
            await order.save();

            res.json({ success: true, shipment: newShipment });
        } else {
            res.status(400).json({ message: result.message || 'NimbusPost shipment creation failed' });
        }
    } catch (error) {
        console.error('Create Shipment Error:', error);
        res.status(500).json({ message: error.message || 'Server error during shipment creation' });
    }
});

/**
 * @route   GET /api/shipments/sync/:id
 * @desc    Sync shipment status with NimbusPost
 * @access  Admin Only
 */
router.get('/sync/:id', adminAuth, async (req, res) => {
    try {
        const shipment = await Shipment.findById(req.params.id);
        if (!shipment || !shipment.awbNumber) {
            return res.status(404).json({ message: 'Shipment or AWB not found' });
        }

        const tracking = await nimbusPostService.trackShipment(shipment.awbNumber);
        if (tracking.status && tracking.data) {
            const newStatus = tracking.data.status_name || shipment.shippingStatus;
            shipment.shippingStatus = newStatus;
            await shipment.save();

            // Update Order as well
            const order = await Order.findById(shipment.orderId);
            if (order && order.status !== newStatus) {
                order.status = newStatus;
                order.timeline.push({ status: newStatus, note: 'Status synced with NimbusPost' });
                await order.save();
            }
        }
        res.json({ success: true, shipment });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
