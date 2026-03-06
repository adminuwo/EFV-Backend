const express = require('express');
const router = express.Router();
const { Order, ReturnRequest, User } = require('../models');
const { protect } = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const multer = require('multer');
const path = require('path');

// Configure Multer for Proof Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'src/uploads/returns/');
    },
    filename: (req, file, cb) => {
        cb(null, `return-${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage });

// --- USER ROUTES ---

// Submit Return Request
router.post('/request', protect, upload.single('imageProof'), async (req, res) => {
    try {
        const { orderId, reason, items } = req.body;

        // Find Order
        const order = await Order.findOne({ orderId });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        // Check if Delivered
        if (order.status !== 'Delivered') {
            return res.status(400).json({ message: 'Only delivered orders can be returned' });
        }

        // Check 7 Days window
        const deliveryDate = order.timeline.find(t => t.status === 'Delivered')?.timestamp || order.updatedAt;
        const diffDays = Math.ceil((new Date() - new Date(deliveryDate)) / (1000 * 60 * 60 * 24));

        if (diffDays > 7) {
            return res.status(400).json({ message: 'Return window (7 days) has closed' });
        }

        // Create Return Request
        const returnReq = await ReturnRequest.create({
            orderId,
            userId: req.user._id,
            items: JSON.parse(items), // expects stringified array of items
            reason,
            imageProof: req.file ? `uploads/returns/${req.file.filename}` : '',
            status: 'Pending'
        });

        // Add to Order Timeline
        order.timeline.push({
            status: 'Return Requested',
            note: `Reason: ${reason}`
        });
        await order.save();

        res.status(201).json({
            success: true,
            message: 'Your return request has been submitted. Our team will review it shortly.',
            request: returnReq
        });

    } catch (error) {
        console.error('Return Request Error:', error);
        res.status(500).json({ message: 'Error submitting return request' });
    }
});

// Get User's Return Requests
router.get('/my-requests', protect, async (req, res) => {
    try {
        const requests = await ReturnRequest.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.json(requests);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching return requests' });
    }
});

// --- ADMIN ROUTES ---

// Get All Return Requests
router.get('/admin/all', adminAuth, async (req, res) => {
    try {
        const requests = await ReturnRequest.find({}).sort({ createdAt: -1 });
        res.json(requests);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching all return requests' });
    }
});

const nimbusPostService = require('../services/nimbusPostService');

// Update Return Request Status (Pending -> Approved/Rejected)
router.put('/admin/update/:id', adminAuth, async (req, res) => {
    try {
        const { status, adminNotes } = req.body;
        const returnReq = await ReturnRequest.findById(req.params.id);

        if (!returnReq) return res.status(404).json({ message: 'Request not found' });

        returnReq.status = status;
        returnReq.adminNotes = adminNotes || returnReq.adminNotes;
        await returnReq.save();

        // Update Order Status if necessary
        const order = await Order.findOne({ orderId: returnReq.orderId });
        if (order) {
            order.timeline.push({
                status: `Return ${status}`,
                note: adminNotes
            });
            await order.save();
        }

        res.json({ success: true, message: `Return request ${status.toLowerCase()}` });

    } catch (error) {
        console.error('Error updating return request:', error);
        res.status(500).json({ message: 'Error updating return request' });
    }
});

// Trigger Reverse Pickup via NimbusPost
router.post('/admin/trigger-pickup/:id', adminAuth, async (req, res) => {
    try {
        const returnReq = await ReturnRequest.findById(req.params.id);
        if (!returnReq) return res.status(404).json({ message: 'Request not found' });

        if (returnReq.status !== 'Approved') {
            return res.status(400).json({ message: 'Only approved requests can trigger pickup' });
        }

        const order = await Order.findOne({ orderId: returnReq.orderId });
        if (!order) return res.status(404).json({ message: 'Order details missing' });

        // Get Address
        const address = order.shippingAddress || {};

        // Call NimbusPost Service
        const nimbusResult = await nimbusPostService.createReverseShipment(returnReq, order, address);

        if (nimbusResult.status) {
            returnReq.status = 'Picked Up';
            returnReq.reverseShipmentId = nimbusResult.data?.shipment_id || nimbusResult.data || 'N/A';
            await returnReq.save();

            order.timeline.push({
                status: 'Return Picked Up',
                note: `NimbusPost ID: ${returnReq.reverseShipmentId}`
            });
            await order.save();

            res.json({ success: true, message: 'Pickup scheduled!', data: nimbusResult.data });
        } else {
            res.status(400).json({ success: false, message: nimbusResult.message || 'NimbusPost Error' });
        }

    } catch (error) {
        console.error('Trigger Pickup Error:', error);
        res.status(500).json({ message: 'Server error triggering pickup' });
    }
});

module.exports = router;
