const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { User, Product } = require('../models');
const { protect } = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// --- PROFILE & DASHBOARD ---

router.get('/profile', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Ensure notifications have IDs for frontend tracking
        let changed = false;
        if (user.notifications && Array.isArray(user.notifications)) {
            user.notifications.forEach(note => {
                if (!note._id && !note.id) {
                    note._id = 'note-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
                    changed = true;
                }
            });

            if (changed) {
                user.markModified('notifications');
                await user.save();
            }
        }

        const userObj = user.toObject ? user.toObject() : JSON.parse(JSON.stringify(user));
        if (userObj.password) delete userObj.password;

        // Ensure notifications exist
        if (!userObj.notifications) userObj.notifications = [];

        // Sort notifications: Welcome pinned to top, rest newest first
        const welcomeNotes = userObj.notifications.filter(n =>
            (n.title || '').toLowerCase().includes('welcome') || (n.message || '').toLowerCase().includes('welcome')
        );
        const otherNotes = userObj.notifications.filter(n =>
            !(n.title || '').toLowerCase().includes('welcome') && !(n.message || '').toLowerCase().includes('welcome')
        );
        
        otherNotes.sort((a, b) => {
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateB - dateA;
        });

        userObj.notifications = [...welcomeNotes, ...otherNotes];
        res.json(userObj);

    } catch (error) {
        console.error('Error fetching profile:', error);
        res.status(500).json({ 
            message: 'Error fetching profile', 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
        });
    }
});

// Update Profile
router.put('/profile', protect, async (req, res) => {
    try {
        const { name, phone } = req.body;
        const user = await User.findById(req.user._id);
        if (user) {
            user.name = name || user.name;
            user.phone = phone || user.phone;
            await user.save();
            res.json({ message: 'Profile updated successfully', user: { name: user.name, email: user.email } });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error('Error updating profile:', error);
        res.status(500).json({ 
            message: 'Error updating profile', 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// --- ADDRESS BOOK ---

// Add Address
router.post('/address', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user.savedAddresses) user.savedAddresses = [];

        if (req.body.isDefault) {
            user.savedAddresses.forEach(a => a.isDefault = false);
        }
        // Ensure ID for JSON DB mode
        if (!req.body._id && !req.body.id) {
            req.body._id = 'addr_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
        }
        user.savedAddresses.push(req.body);
        await user.save();
        res.status(201).json(user.savedAddresses);
    } catch (error) {
        res.status(500).json({ message: 'Error adding address' });
    }
});

// Update Address
router.put('/address/:id', protect, async (req, res) => {
    try {
        const addrId = req.params.id;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.savedAddresses) user.savedAddresses = [];
        const index = user.savedAddresses.findIndex(a => (a._id || a.id || '').toString() === addrId);
        
        if (index !== -1) {
            if (req.body.isDefault) {
                user.savedAddresses.forEach(a => a.isDefault = false);
            }
            const existing = user.savedAddresses[index];
            user.savedAddresses[index] = { ...existing.toObject ? existing.toObject() : existing, ...req.body };
            user.markModified('savedAddresses');
            await user.save();
            res.json(user.savedAddresses);
        } else {
            res.status(404).json({ message: 'Address not found' });
        }
    } catch (error) {
        console.error('Error updating address:', error);
        res.status(500).json({ message: 'Error updating address' });
    }
});

// Delete Address
router.delete('/address/:id', protect, async (req, res) => {
    try {
        const addrId = req.params.id;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.savedAddresses) user.savedAddresses = [];
        user.savedAddresses = user.savedAddresses.filter(a => (a._id || a.id || '').toString() !== addrId);
        user.markModified('savedAddresses');
        await user.save();
        res.json(user.savedAddresses);
    } catch (error) {
        console.error('Error deleting address:', error);
        res.status(500).json({ message: 'Error deleting address' });
    }
});

// --- WISHLIST ---

// Toggle Wishlist Item
router.post('/wishlist/toggle', protect, async (req, res) => {
    try {
        const { productId } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.wishlist) user.wishlist = [];
        const idx = user.wishlist.findIndex(id => id.toString() === productId);
        if (idx > -1) {
            user.wishlist.splice(idx, 1);
        } else {
            user.wishlist.push(productId);
        }
        user.markModified('wishlist');
        await user.save();
        res.json({ message: 'Wishlist updated', wishlist: user.wishlist });
    } catch (error) {
        console.error('Error toggling wishlist:', error);
        res.status(500).json({ message: 'Error toggling wishlist' });
    }
});

// --- NOTIFICATIONS ---

// Get Notifications
router.get('/notifications', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        let changed = false;

        // Ensure every notification has an ID for frontend tracking
        user.notifications.forEach(note => {
            if (!note._id && !note.id) {
                note._id = 'note-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
                changed = true;
            }
        });

        if (changed) {
            await user.save();
        }

        // Sort: Welcome pinned to top, rest newest first
        const notes = user.notifications;
        const welcomeNotes = notes.filter(n =>
            (n.title || '').toLowerCase().includes('welcome') || (n.message || '').toLowerCase().includes('welcome')
        );
        const otherNotes = notes.filter(n =>
            !(n.title || '').toLowerCase().includes('welcome') && !(n.message || '').toLowerCase().includes('welcome')
        );
        otherNotes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json([...welcomeNotes, ...otherNotes]);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching notifications' });
    }
});

// Mark Notification as Read
router.put('/notifications/:id/read', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const note = user.notifications.find(n => (n._id || n.id).toString() === req.params.id);
        if (note) {
            note.isRead = true;
            await user.save();
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error updating notification' });
    }
});

// Mark All Notifications as Read
router.put('/notifications/read-all', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        user.notifications.forEach(n => n.isRead = true);
        await user.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: 'Error updating notifications' });
    }
});

// Delete Notification (ATOMIC V2)
router.delete('/notifications/:id', protect, async (req, res) => {
    try {
        const reqId = req.params.id;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.notifications) user.notifications = [];
        const initialCount = user.notifications.length;

        user.notifications = user.notifications.filter(n => {
            const rawId = n._id || n.id; // Ensure compatibility for plain objects (JSON DB)
            if (!rawId) return true;
            const dbId = rawId.toString();
            return dbId !== reqId;
        });

        if (user.notifications.length === initialCount) {
             return res.status(404).json({ message: 'Notification not found' });
        }

        user.markModified('notifications');
        await user.save();
        res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ message: 'Error deleting notification' });
    }
});

// --- SECURITY ---

// Change Password
router.post('/change-password', protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user._id);

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(400).json({ message: 'Incorrect current password' });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error changing password' });
    }
});

// --- ADMIN ROUTES ---

// Get all users (Admin Only)
router.get('/', adminAuth, async (req, res) => {
    try {
        const users = await User.find({ role: 'user' }).select('-password');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users' });
    }
});

module.exports = router;
