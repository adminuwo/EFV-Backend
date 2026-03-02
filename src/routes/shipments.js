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

        // Improve address construction
        const addressDetails = order.customer.address || {};
        const addressString = [
            addressDetails.house,
            addressDetails.street,
            addressDetails.area,
            addressDetails.landmark,
            addressDetails.fullAddress
        ].filter(Boolean).join(', ') || order.customer.name || 'No address provided';

        // Prepare NimbusPost Payload (Updated to match required keys)
        const payload = {
            order_number: order.orderId,
            consignee_name: order.customer.name,
            consignee_email: order.customer.email,
            consignee_phone: order.customer.phone || '0000000000',
            consignee_address: addressString,
            consignee_city: order.customer.city || addressDetails.city || 'Unknown',
            consignee_state: order.customer.state || addressDetails.state || 'Unknown',
            consignee_pincode: order.customer.zip || addressDetails.pincode || '000000',
            consignee_country: 'India',

            // Warehouse / Pickup details (Required)
            pickup_warehouse_name: "Office",
            pickup_contact_name: "Abha",
            pickup_phone: "9123456789",
            pickup_address: "Jabalpur",
            pickup_city: "Jabalpur",
            pickup_state: "Madhya Pradesh",
            pickup_pincode: "482001",

            order_items: order.items.map(item => ({
                name: item.title,
                qty: item.quantity,
                price: item.price,
                sku: item.productId?.title || item.title
            })),
            payment_type: order.paymentMethod.toLowerCase() === 'cod' ? 'cod' : 'prepaid',
            order_total: order.totalAmount,
            weight: order.items.reduce((sum, item) => sum + (item.productId?.weight || 500) * item.quantity, 0),
            length: 10, breadth: 10, height: 10,
            // Mandatory for new API versions:
            support_email: "sreshthi+3296@uwo24.com",
            support_phone: "9123456789"
        };

        console.log('📦 Manual Nimbus Shipment Payload:', JSON.stringify(payload, null, 2));
        const result = await nimbusPostService.createShipment(payload);
        console.log('📄 Manual Nimbus API Result:', JSON.stringify(result, null, 2));

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
