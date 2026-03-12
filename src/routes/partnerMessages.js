const express = require('express');
const router = express.Router();
const { PartnerMessage, Partner } = require('../models');
const partnerAuth = require('../middleware/partnerAuth');
const { protect, admin } = require('../middleware/auth'); // Fixed import

/**
 * @route   POST /api/partner-messages/partner
 * @desc    Partner sends a message to Admin
 */
router.post('/partner', partnerAuth, async (req, res) => {
    try {
        const { subject, message_text } = req.body;
        const partner = req.partner;

        if (!message_text) return res.status(400).json({ message: 'Message text is required' });

        const newMessage = await PartnerMessage.create({
            partnerId: partner._id.toString(),
            partnerName: partner.name,
            partnerEmail: partner.email,
            subject: subject || 'No Subject',
            message_text,
            sender_type: 'partner',
            status: 'Open',
            isReadByAdmin: false,
            isReadByPartner: true,
            createdAt: new Date().toISOString()
        });

        res.status(201).json(newMessage);
    } catch (error) {
        console.error('Partner Send Message Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @route   GET /api/partner-messages/partner
 * @desc    Get conversation history for a partner
 */
router.get('/partner', partnerAuth, async (req, res) => {
    try {
        const partner = req.partner;
        const messages = await PartnerMessage.find({ partnerId: partner._id.toString() }).sort({ createdAt: 1 });
        
        // Mark all as read by partner when they view the chat
        await PartnerMessage.updateMany(
            { partnerId: partner._id.toString(), sender_type: 'admin', isReadByPartner: false },
            { $set: { isReadByPartner: true } }
        );

        res.json(messages);
    } catch (error) {
        console.error('Partner Get Messages Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @route   GET /api/partner-messages/admin/summary
 * @desc    Get summary of all partner conversations (Admin only)
 */
router.get('/admin/summary', protect, admin, async (req, res) => {
    try {
        const messages = await PartnerMessage.find({});
        
        // Group by partnerId
        const summaryMap = {};
        messages.forEach(m => {
            if (!summaryMap[m.partnerId]) {
                summaryMap[m.partnerId] = {
                    partnerId: m.partnerId,
                    partnerName: m.partnerName,
                    partnerEmail: m.partnerEmail,
                    lastMessage: m.message_text,
                    lastDate: m.createdAt,
                    unreadCount: 0,
                    status: 'Open'
                };
            }
            
            if (new Date(m.createdAt) > new Date(summaryMap[m.partnerId].lastDate)) {
                summaryMap[m.partnerId].lastMessage = m.message_text;
                summaryMap[m.partnerId].lastDate = m.createdAt;
            }

            if (m.sender_type === 'partner' && !m.isReadByAdmin) {
                summaryMap[m.partnerId].unreadCount++;
            }

            if (m.status === 'Open') {
                summaryMap[m.partnerId].status = 'Open';
            }
        });

        const summary = Object.values(summaryMap).sort((a, b) => new Date(b.lastDate) - new Date(a.lastDate));
        res.json(summary);
    } catch (error) {
        console.error('Admin Get Summary Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @route   GET /api/partner-messages/admin/:partnerId
 * @desc    Get full conversation with a specific partner (Admin only)
 */
router.get('/admin/:partnerId', protect, admin, async (req, res) => {
    try {
        const { partnerId } = req.params;
        const messages = await PartnerMessage.find({ partnerId }).sort({ createdAt: 1 });

        // Mark as read by admin
        await PartnerMessage.updateMany(
            { partnerId, sender_type: 'partner', isReadByAdmin: false },
            { $set: { isReadByAdmin: true } }
        );

        res.json(messages);
    } catch (error) {
        console.error('Admin Get Messages Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @route   POST /api/partner-messages/admin/reply
 * @desc    Admin replies to a partner
 */
router.post('/admin/reply', protect, admin, async (req, res) => {
    try {
        const { partnerId, message_text } = req.body;
        if (!partnerId || !message_text) return res.status(400).json({ message: 'Partner ID and message are required' });

        // Find partner info from latest message
        const lastMsg = await PartnerMessage.findOne({ partnerId });
        
        const newMessage = await PartnerMessage.create({
            partnerId,
            partnerName: lastMsg ? lastMsg.partnerName : 'Unknown',
            partnerEmail: lastMsg ? lastMsg.partnerEmail : 'Unknown',
            subject: lastMsg ? lastMsg.subject : 'Admin Reply',
            message_text,
            sender_type: 'admin',
            status: 'Open',
            isReadByAdmin: true,
            isReadByPartner: false,
            createdAt: new Date().toISOString()
        });

        res.status(201).json(newMessage);
    } catch (error) {
        console.error('Admin Reply Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @route   PUT /api/partner-messages/admin/resolve/:partnerId
 * @desc    Mark conversation as resolved
 */
router.put('/admin/resolve/:partnerId', protect, admin, async (req, res) => {
    try {
        const { partnerId } = req.params;
        await PartnerMessage.updateMany(
            { partnerId },
            { $set: { status: 'Resolved' } }
        );

        res.json({ message: 'Conversation marked as resolved' });
    } catch (error) {
        console.error('Admin Resolve Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @route   GET /api/partner-messages/notifications
 * @desc    Get unread notification status for current user (Partner or Admin)
 */
router.get('/notifications', async (req, res) => {
    // This route should handle both types or we can split it.
    // For simplicity, let's check headers/tokens manually or rely on multiple middleware if possible.
    // Let's just create separate ones to avoid confusion.
    res.status(404).json({ message: 'Use specific notification routes' });
});

router.get('/notifications/partner', partnerAuth, async (req, res) => {
    try {
        const partner = req.partner;
        const unreadCount = await PartnerMessage.find({ 
            partnerId: partner._id.toString(), 
            sender_type: 'admin', 
            isReadByPartner: false 
        }).exec().then(msgs => msgs.length);

        res.json({ unreadCount });
    } catch (error) {
        res.status(500).json({ unreadCount: 0 });
    }
});

router.get('/notifications/admin', protect, admin, async (req, res) => {
    try {
        const unreadCount = await PartnerMessage.find({ 
            sender_type: 'partner', 
            isReadByAdmin: false 
        }).exec().then(msgs => msgs.length);

        res.json({ unreadCount });
    } catch (error) {
        res.status(500).json({ unreadCount: 0 });
    }
});

module.exports = router;
