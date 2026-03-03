const express = require('express');
const router = express.Router();
const { Support } = require('../models');
const { protect, admin } = require('../middleware/auth');
const sendEmail = require('../utils/emailService');
const { appendContactRow } = require('../utils/googleSheets');

const ADMIN_EMAIL = 'admin@uwo24.com';

// @desc    Submit a support message
// @route   POST /api/support/message
// @access  Public (or protected if user is logged in)
router.post('/message', async (req, res) => {
    try {
        const { name, email, subject, message, userId } = req.body;

        if (!email || !message) {
            return res.status(400).json({ message: 'Email and message are required' });
        }

        const supportMessage = await Support.create({
            userId: userId || null,
            name: name || 'Anonymous',
            email,
            subject: subject || 'No Subject',
            message,
            status: 'Open'
        });

        // 📧 Send professional email to Admin
        try {
            await sendEmail({
                email: ADMIN_EMAIL,
                subject: `📩 New Contact Form Message — ${subject || 'General Enquiry'}`,
                html: `
                    <div style="font-family: 'Arial', sans-serif; max-width: 650px; margin: 0 auto; background: #0a0a0a; border: 1px solid #FFD369; border-radius: 12px; overflow: hidden;">
                        <!-- Header -->
                        <div style="background: linear-gradient(135deg, #1a1a1a, #0a0a0a); padding: 30px 40px; border-bottom: 2px solid #FFD369; text-align: center;">
                            <h1 style="color: #FFD369; font-size: 22px; margin: 0; letter-spacing: 2px; text-transform: uppercase;">EFV™ Support Desk</h1>
                            <p style="color: #888; margin: 6px 0 0; font-size: 13px;">New message from Contact Form</p>
                        </div>

                        <!-- Body -->
                        <div style="padding: 35px 40px;">
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 10px 0; border-bottom: 1px solid #1e1e1e;">
                                        <span style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">From</span><br>
                                        <span style="color: #fff; font-size: 15px; font-weight: bold;">${name || 'Anonymous'}</span>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 0; border-bottom: 1px solid #1e1e1e;">
                                        <span style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Email</span><br>
                                        <a href="mailto:${email}" style="color: #FFD369; font-size: 15px; text-decoration: none;">${email}</a>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 0; border-bottom: 1px solid #1e1e1e;">
                                        <span style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Subject</span><br>
                                        <span style="color: #fff; font-size: 15px;">${subject || 'No Subject'}</span>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 15px 0;">
                                        <span style="color: #888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Message</span><br>
                                        <div style="background: #111; border-left: 3px solid #FFD369; padding: 15px 20px; margin-top: 10px; border-radius: 0 8px 8px 0;">
                                            <p style="color: #ddd; font-size: 15px; line-height: 1.7; margin: 0; white-space: pre-wrap;">${message}</p>
                                        </div>
                                    </td>
                                </tr>
                            </table>

                            <div style="margin-top: 30px; text-align: center;">
                                <a href="mailto:${email}?subject=Re: ${encodeURIComponent(subject || 'Your Enquiry')}"
                                   style="display: inline-block; background: #FFD369; color: #000; font-weight: bold; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-size: 14px; letter-spacing: 1px;">
                                    ↩ Reply to ${name || 'User'}
                                </a>
                            </div>
                        </div>

                        <!-- Footer -->
                        <div style="background: #111; padding: 20px 40px; text-align: center; border-top: 1px solid #1e1e1e;">
                            <p style="color: #555; font-size: 12px; margin: 0;">Received: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
                            <p style="color: #555; font-size: 12px; margin: 4px 0 0;">EFV™ — Energy Frequency Vibration</p>
                        </div>
                    </div>
                `
            });
            console.log(`📧 Admin notified of new contact from: ${email}`);
        } catch (emailErr) {
            console.error('Admin notification email failed:', emailErr.message);
            // Don't fail the request if email fails
        }

        // 📊 Append to Google Sheet (runs silently)
        appendContactRow({ name, email, subject, message }).catch(e =>
            console.error('Google Sheets append failed:', e.message)
        );

        res.status(201).json({ message: 'Support message sent successfully', data: supportMessage });
    } catch (error) {
        console.error('Support Message Error:', error);
        res.status(500).json({ message: 'Error sending support message' });
    }
});

// @desc    Get all support messages (Admin only)
// @route   GET /api/support/messages
// @access  Private/Admin
router.get('/messages', protect, admin, async (req, res) => {
    try {
        const messages = await Support.find({});
        res.json(messages);
    } catch (error) {
        console.error('Fetch Support Messages Error:', error);
        res.status(500).json({ message: 'Error fetching support messages' });
    }
});

// @desc    Get current user's support messages
// @route   GET /api/support/my-messages
// @access  Private
router.get('/my-messages', protect, async (req, res) => {
    try {
        const messages = await Support.find({ userId: req.user._id || req.user.id });
        res.json(messages);
    } catch (error) {
        console.error('Fetch My Support Messages Error:', error);
        res.status(500).json({ message: 'Error fetching your support messages' });
    }
});

// @desc    Update support message status
// @route   PUT /api/support/messages/:id
// @access  Private/Admin
router.put('/messages/:id', protect, admin, async (req, res) => {
    try {
        const { status } = req.body;
        const message = await Support.findByIdAndUpdate(req.params.id, { status }, { new: true });

        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        res.json({ message: 'Message status updated', data: message });
    } catch (error) {
        console.error('Update Support Message Error:', error);
        res.status(500).json({ message: 'Error updating support message' });
    }
});

// @desc    Reply to a support message
// @route   POST /api/support/messages/:id/reply
// @access  Private/Admin
router.post('/messages/:id/reply', protect, admin, async (req, res) => {
    try {
        const { reply } = req.body;
        if (!reply) return res.status(400).json({ message: 'Reply content is required' });

        const { Support, User } = require('../models');
        const message = await Support.findById(req.params.id);

        if (!message) {
            console.error(`Reply Error: Message ID ${req.params.id} not found`);
            return res.status(404).json({ message: 'Message not found' });
        }

        console.log(`Processing reply for Support ID: ${message._id || message.id}`);

        // Update Support Message
        message.reply = reply;
        message.repliedAt = new Date().toISOString();
        message.status = 'Resolved';

        // Ensure manual save for JSON DB visibility if needed, or rely on .save()
        const savedMessage = await message.save();
        console.log(`✅ Message updated with status: ${savedMessage.status}`);

        // Send Notification to User if userId exists
        if (message.userId) {
            const user = await User.findById(message.userId);
            if (user) {
                console.log(`🔔 Sending notification to User: ${user.email} (${user._id || user.id})`);
                if (!user.notifications) user.notifications = [];

                const newNotification = {
                    _id: 'reply-' + Date.now(),
                    title: 'New Support Reply',
                    message: `Admin replied to your ticket: "${message.subject}"`,
                    type: 'General',
                    link: 'profile.html?tab=support',
                    isRead: false,
                    createdAt: new Date().toISOString()
                };

                user.notifications.unshift(newNotification);
                await user.save();
                console.log("✅ User notification saved");
            } else {
                console.warn(`⚠️ User ID ${message.userId} not found for notification`);
            }
        } else {
            console.log("ℹ️ No userId on message, skipping notification");
        }

        res.json({ message: 'Reply sent successfully', data: message });
    } catch (error) {
        console.error('Support Reply Error:', error);
        res.status(500).json({ message: 'Error sending reply: ' + error.message });
    }
});

module.exports = router;
