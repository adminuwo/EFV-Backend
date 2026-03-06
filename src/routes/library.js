const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { User, Purchase, Product, UserProgress, DigitalLibrary } = require('../models');


// Get user's digital library
router.get('/my-library', protect, async (req, res) => {
    try {
        let libraryData = await DigitalLibrary.findOne({ userId: req.user._id.toString() });
        let rawItems = libraryData ? (libraryData.items || []) : [];

        // Helper to sync an item with latest product data
        const syncItemWithProduct = async (item) => {
            try {
                const productId = (item.productId || item._id || item.id || '').toString();
                let product = null;

                // Try finding by ID first - works for BOTH MongoDB ObjectIds AND string IDs like 'efv_v1_ebook'
                // DO NOT gate this behind ObjectId.isValid() — our JSON DB uses string IDs!
                if (productId) {
                    product = await Product.findById(productId);
                }

                // Fallback: Fuzzy matching by title (JSON adapter supports RegExp, NOT $regex object syntax)
                if (!product) {
                    const searchTitle = (item.title || item.name || '').replace(/\(.*\)/, '').trim();
                    const productType = (item.type || '').toUpperCase()
                        .replace('E-BOOK', 'EBOOK').replace('AUDIOBOOK', 'AUDIOBOOK');

                    if (searchTitle) {
                        product = await Product.findOne({
                            title: new RegExp(searchTitle.replace(/[™®]/g, '').trim(), 'i'),
                            type: productType
                        });
                    }
                }

                if (product) {
                    return {
                        productId: product._id,
                        title: product.title,
                        type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                        thumbnail: product.thumbnail || item.thumbnail,
                        filePath: product.filePath || item.filePath,
                        purchasedAt: item.purchasedAt || item.createdAt || new Date(),
                        progress: item.progress || 0
                    };
                }
                // Return item as-is (still usable even without product enrichment)
                return item;
            } catch (err) {
                console.error('Library Item Sync Error:', err);
                return item;
            }
        };

        // --- NEW: Demo/JSON Fallback ---
        // --- NEW: Demo/JSON Fallback ---
        let demoItems = [];
        /* 
        if (process.env.USE_JSON_DB === 'true' || rawItems.length === 0) {
            try {
                const JsonDB = require('../utils/jsonDB');
                const demoUsersDB = new JsonDB('demo_users.json');
                const demoUser = demoUsersDB.getById(req.user.email);

                if (demoUser && demoUser.library) {
                    demoItems = demoUser.library;
                }
            } catch (err) {
                console.error('Demo fallback error:', err);
            }
        }
        */

        // Merge and process all items
        const allItems = [...rawItems, ...demoItems];

        // Use a Map to deduplicate by productId while syncing
        const libraryMap = new Map();
        for (const item of allItems) {
            const synced = await syncItemWithProduct(item);
            const id = synced.productId?.toString();
            if (id && !libraryMap.has(id)) {
                libraryMap.set(id, synced);
            }
        }

        let library = Array.from(libraryMap.values());

        // NOTE: Legacy fallback removed intentionally.
        // Previously, if library was empty it re-synced from purchases — this caused deleted
        // items to reappear. Now, an empty library = user has no items. That's correct behavior.

        // Sort by purchasedAt descending (Latest First)
        library.sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));

        res.json(library);
    } catch (error) {
        console.error('Error fetching library:', error);
        res.status(500).json({ message: 'Error fetching library' });
    }
});

// Save Progress
router.post('/progress', protect, async (req, res) => {
    try {
        const { productId, progress, total } = req.body;
        const userId = req.user._id;

        const updatedProgress = await UserProgress.findOneAndUpdate(
            { userId, productId },
            { progress, total, lastUpdated: Date.now() },
            { upsert: true, new: true }
        );

        res.json(updatedProgress);
    } catch (error) {
        console.error('Error saving progress:', error);
        res.status(500).json({ message: 'Error saving progress' });
    }
});

// Get Progress
router.get('/progress/:productId', protect, async (req, res) => {
    try {
        const userId = req.user._id;
        const productId = req.params.productId;

        const progress = await UserProgress.findOne({ userId, productId });

        res.json(progress || { progress: 0, total: 0 });
    } catch (error) {
        console.error('Error fetching progress:', error);
        res.status(500).json({ message: 'Error fetching progress' });
    }
});

// Add product to user's library (Manual/Instant Fulfillment)
router.post('/add', protect, async (req, res) => {
    try {
        const { productId } = req.body;
        const userId = req.user._id;

        let product = null;

        // 1. Try finding by ID first
        if (mongoose.Types.ObjectId.isValid(productId)) {
            product = await Product.findById(productId);
        }

        // 2. Fallback: Fuzzy matching by title (for Demo/Legacy IDs)
        if (!product) {
            // We don't have the title in the request body usually, 
            // but we can try to find what the frontend might be sending if we had more info.
            // However, for this POST /add, the frontend should ideally send the REAL ID if it matched it in mergeBackendData.
            // If it didn't, we can't fuzzy match without a title.
            // Let's check if the productId is one of our known demo IDs and map it manually if needed.

            const demoMap = {
                // Hindi Editions (Match "ORIGIN CODE" but NOT "THE ORIGIN CODE")
                'efv_v1_ebook': { title: /^EFV™ VOL 1: ORIGIN CODE™$/i, type: 'EBOOK' },
                'efv_v1_audiobook': { title: /^EFV™ VOL 1: ORIGIN CODE™$/i, type: 'AUDIOBOOK' },

                // English Editions (Match "THE ORIGIN CODE")
                'efv_v1_ebook_en': { title: /THE ORIGIN CODE/i, type: 'EBOOK' },
                'efv_v1_audiobook_en': { title: /THE ORIGIN CODE/i, type: 'AUDIOBOOK' },

                'efv_v2_ebook': { title: /MINDOS/i, type: 'EBOOK' },
                'efv_v2_audiobook': { title: /MINDOS/i, type: 'AUDIOBOOK' }
            };

            const demoSpec = demoMap[productId];
            if (demoSpec) {
                product = await Product.findOne({
                    title: demoSpec.title,
                    type: demoSpec.type
                });
            }
        }

        if (!product) return res.status(404).json({ message: 'Product not found' });

        let library = await DigitalLibrary.findOne({ userId });
        if (!library) {
            library = new DigitalLibrary({ userId, items: [] });
        }

        // Check if already in library
        const isOwned = library.items.some(item => item.productId.toString() === product._id.toString());
        if (isOwned) {
            return res.status(400).json({ message: 'Product already in your library' });
        }

        // Add to library
        library.items.push({
            productId: product._id,
            title: product.title,
            type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
            thumbnail: product.thumbnail,
            filePath: product.filePath,
            purchasedAt: new Date(),
            orderId: 'MANUAL',
            accessStatus: 'active'
        });

        await library.save();
        res.status(201).json({ message: 'Product added to library successfully', library });
    } catch (error) {
        console.error('Error adding to library:', error);
        res.status(500).json({ message: 'Error adding to library' });
    }
});

// DELETE item from user's digital library (permanent ATOMIC)
router.delete('/my-library/:productId', protect, async (req, res) => {
    try {
        const userId = req.user._id.toString();
        const { productId } = req.params;

        console.log(`🗑️ ATOMIC LIBRARY REMOVE: ${productId} for ${userId}`);

        const updatedLib = await DigitalLibrary.findOneAndUpdate(
            { userId },
            (lib) => {
                if (!lib || !lib.items) return lib;
                const initialCount = lib.items.length;
                lib.items = lib.items.filter(item => {
                    const id = (item.productId || item._id || item.id || '').toString();
                    return id !== productId.toString();
                });
                lib._lastStatus = (lib.items.length < initialCount) ? 'SUCCESS' : 'NOT_FOUND';
                lib.updatedAt = new Date().toISOString();
                return lib;
            }
        );

        if (!updatedLib || updatedLib._lastStatus === 'NOT_FOUND') {
            return res.status(404).json({ message: 'Item not found in library' });
        }

        console.log(`✅ ATOMIC LIBRARY REMOVE SUCCESS: ${productId}`);
        res.json({ message: 'Item removed from library', library: updatedLib });
    } catch (error) {
        console.error('Error removing from library:', error);
        res.status(500).json({ message: 'Error removing from library' });
    }
});

module.exports = router;
