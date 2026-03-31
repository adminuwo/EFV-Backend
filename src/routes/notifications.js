const express = require('express');
const router = express.Router();
const { NotifyRequest, User } = require('../models');
const sendEmail = require('../utils/emailService');
const adminAuth = require('../middleware/adminAuth');

// --- 1. USER NOTIFICATION REQUEST (PUBLIC) ---
router.post('/notify-me', async (req, res) => {
    try {
        let { email, bookTitle, productTitle, bookId } = req.body;
        
        // Handle variations in field naming across versions
        if (!bookTitle && productTitle) bookTitle = productTitle;

        if (!email || !bookTitle) {
            return res.status(400).json({ message: 'Email and Product Title are required' });
        }

        // Check if already requested
        const existing = await NotifyRequest.findOne({ email, bookTitle });
        if (existing) {
            return res.json({ message: 'You are already on the notification list for this book!' });
        }

        // Find user if logged in
        const user = await User.findOne({ email });

        // Save request
        const request = await NotifyRequest.create({
            email,
            bookTitle,
            bookId,
            userId: user ? user._id : null,
            status: 'Pending'
        });

        // Send Confirmation Email
        try {
            await sendEmail({
                email,
                subject: 'Alignment Confirmed! - EFV™',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #000; color: #fff; border: 1px solid #FFD369; border-radius: 10px;">
                        <h2 style="color: #FFD369; text-align: center;">Alignment Confirmed!</h2>
                        <p>Hello,</p>
                        <p>Thank you for your interest in <strong>"${bookTitle}"</strong> by EFV™.</p>
                        <p>We have successfully received your request. You will be among the first to be notified via this email address as soon as this volume is ready to release.</p>
                        <p>Stay tuned for your journey into higher frequencies.</p>
                        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; font-size: 12px; opacity: 0.6; text-align: center;">
                            © 2026 EFV™ - Energy, Frequency, Vibration
                        </div>
                    </div>
                `
            });
        } catch (emailErr) {
            console.error('Notify Confirmation Email Error:', emailErr.message);
        }

        // Send In-App Notification if user exists
        if (user) {
            if (!user.notifications) user.notifications = [];
            user.notifications.unshift({
                _id: 'notify-' + Date.now(),
                title: 'Alignment Confirmed! 🔔',
                message: `You will be notified when "${bookTitle}" is available.`,
                type: 'General',
                isRead: false,
                createdAt: new Date().toISOString()
            });
            await user.save();
        }

        res.status(201).json({ message: 'Success! We will notify you when it is ready.' });

    } catch (error) {
        console.error('Notify Error:', error);
        res.status(500).json({ message: 'Error processing notification request' });
    }
});

// --- 2. ADMIN: GET ALL REQUESTS ---
router.get('/requests', adminAuth, async (req, res) => {
    try {
        const requests = await NotifyRequest.find().sort({ createdAt: -1 });
        res.json(requests);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching requests' });
    }
});

// --- 3. ADMIN: TRIGGER MANUAL NOTIFICATION ---
router.post('/trigger-release', adminAuth, async (req, res) => {
    try {
        const { bookTitle } = req.body;

        if (!bookTitle) {
            return res.status(400).json({ message: 'Book Title is required' });
        }

        const requests = await NotifyRequest.find({ bookTitle, status: 'Pending' });
        console.log(`📢 Notifying ${requests.length} users about "${bookTitle}" release...`);

        for (const reqObj of requests) {
            // Send Email
            try {
                await sendEmail({
                    email: reqObj.email,
                    subject: `Available Now: "${bookTitle}" - EFV™`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #000; color: #fff; border: 1px solid #FFD369; border-radius: 10px;">
                            <h2 style="color: #FFD369; text-align: center;">Available Now!</h2>
                            <p>Hello,</p>
                            <p>Great news! The book you were waiting for, <strong>"${bookTitle}"</strong>, is now available in the EFV™ Marketplace.</p>
                            <p>You can now browse and purchase it to continue your journey into higher frequencies.</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="https://efvframework.com/pages/marketplace.html" style="background: #FFD369; color: #000; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Browse Marketplace</a>
                            </div>
                            <p>Stay tuned for more updates.</p>
                            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #333; font-size: 12px; opacity: 0.6; text-align: center;">
                                © 2026 EFV™ - Energy, Frequency, Vibration
                            </div>
                        </div>
                    `
                });
            } catch (emailErr) {
                console.error(`Release Email Error for ${reqObj.email}:`, emailErr.message);
            }

            // In-App Notification
            if (reqObj.userId) {
                const user = await User.findById(reqObj.userId);
                if (user) {
                    if (!user.notifications) user.notifications = [];
                    user.notifications.unshift({
                        _id: 'release-' + Date.now(),
                        title: 'Book Available! 📚',
                        message: `"${bookTitle}" is now live in the marketplace.`,
                        type: 'General',
                        link: 'marketplace.html',
                        isRead: false,
                        createdAt: new Date().toISOString()
                    });
                    await user.save();
                }
            } else {
                // Try finding user by email even if userId wasn't stored
                const user = await User.findOne({ email: reqObj.email });
                if (user) {
                    if (!user.notifications) user.notifications = [];
                    user.notifications.unshift({
                        _id: 'release-' + Date.now(),
                        title: 'Book Available! 📚',
                        message: `"${bookTitle}" is now live in the marketplace.`,
                        type: 'General',
                        link: 'marketplace.html',
                        isRead: false,
                        createdAt: new Date().toISOString()
                    });
                    await user.save();
                }
            }

            // Mark as Notified
            reqObj.status = 'Notified';
            await reqObj.save();
        }

        res.json({ message: `Successfully notified ${requests.length} users.` });

    } catch (error) {
        console.error('Trigger Release Error:', error);
        res.status(500).json({ message: 'Error triggering release notifications' });
    }
});

module.exports = router;
