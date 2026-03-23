const express = require('express');
const router = express.Router();
const { Cart, Product } = require('../models');
const { protect } = require('../middleware/auth');

/**
 * Sync Local Cart to Server
 * This endpoint is called whenever the frontend cart changes or once per session.
 * It tracks the last update for abandoned cart recovery.
 */
router.post('/sync', protect, async (req, res) => {
    try {
        const { items } = req.body; // Array of { productId, quantity }
        const userId = req.user._id;

        let cart = await Cart.findOne({ userId });
        
        if (!cart) {
            cart = new Cart({ userId, items: [] });
        }

        // Update items
        cart.items = items.map(item => ({
            productId: item.productId,
            quantity: item.quantity || 1,
            addedAt: new Date()
        }));

        cart.lastSyncedAt = new Date();
        cart.isPurchased = false; // Reset purchase status since items changed
        // Optionally reset reminders if cart is significantly updated
        if (items.length > 0) {
            cart.remindersSent = 0; 
        }

        await cart.save();
        res.json({ success: true, cart });
    } catch (error) {
        console.error('Cart Sync Error:', error);
        res.status(500).json({ message: 'Error syncing cart' });
    }
});

/**
 * Get Current User Cart
 */
router.get('/', protect, async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user._id }).populate('items.productId');
        if (!cart) return res.json({ items: [] });
        res.json(cart);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching cart' });
    }
});

module.exports = router;
