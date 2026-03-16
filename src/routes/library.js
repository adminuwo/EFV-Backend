const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { User, Purchase, Product, UserProgress, DigitalLibrary } = require('../models');


// Get user's digital library
router.get('/test-ping', (req, res) => res.json({ message: 'Library Route v1.3 is ACTIVE', timestamp: new Date() }));

router.get('/my-library', protect, async (req, res) => {
    try {
        let libraryData = await DigitalLibrary.findOne({ userId: req.user._id.toString() });
        let rawItems = libraryData ? (libraryData.items || []) : [];

        const userEmail = (req.user.email || '').toLowerCase().trim();
        const isAdmin = req.user.role === 'admin' || userEmail === 'admin@uwo24.com';

        if (isAdmin) {
            console.log(`🔍 [ADMIN SYNC] detected for ${userEmail}. Fetching all digital products...`);
            // Admin FORCE SYNC: They always get access to ALL digital products
            // Using case-insensitive regex to catch EBOOK, Ebook, E-Book, AUDIOBOOK, etc.
            const allDigitalProducts = await Product.find({
                type: /^(EBOOK|AUDIOBOOK|E-BOOK)$/i
            });
            console.log(`👨‍💼 Admin Library Sync: Found ${allDigitalProducts.length} digital products for ${req.user.email}`);

            const adminDigitalItems = allDigitalProducts.map(p => ({
                productId: p._id,
                title: p.title,
                type: (p.type || '').toUpperCase().includes('AUDIO') ? 'Audiobook' : 'E-Book',
                thumbnail: p.thumbnail,
                filePath: p.filePath,
                purchasedAt: p.createdAt || new Date(),
                accessStatus: 'active',
                isAutoUnlocked: true // Mark as auto-unlocked for admin
            }));

            // Smart Merge: Start with all products (active), then overwrite with user's specific progress/hidden status
            const itemsMap = new Map();
            adminDigitalItems.forEach(item => itemsMap.set(item.productId.toString(), item));

            // Overwrite with actual library data (which might have progress, or be 'hidden')
            if (rawItems && Array.isArray(rawItems)) {
                rawItems.forEach(item => {
                    const id = (item.productId ? item.productId.toString() : (item._id ? item._id.toString() : null));
                    if (id && itemsMap.has(id)) {
                        // Overwrite global product data with user's specific library data (like hidden status or progress)
                        const existing = itemsMap.get(id);
                        const userSpecific = item.toObject ? item.toObject() : item;
                        itemsMap.set(id, { ...existing, ...userSpecific });
                    }
                });
            }

            // For admins, we filter out anything explicitly marked as 'hidden'
            rawItems = Array.from(itemsMap.values()).filter(item => item.accessStatus !== 'hidden');
        }

        // Helper to sync an item with latest product data
        const syncItemWithProduct = async (item) => {
            try {
                const productId = (item.productId || item._id || item.id || '').toString();
                let product = null;

                // Try finding by ID first
                if (productId && mongoose.Types.ObjectId.isValid(productId)) {
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

        // Use a Map to deduplicate by productId AND a Set for Titles to handle DB duplicates
        const libraryMap = new Map();
        const seenTitles = new Set();

        for (const item of allItems) {
            const synced = await syncItemWithProduct(item);
            const id = synced.productId?.toString();
            const titleKey = `${synced.title}_${synced.type}`.toLowerCase().replace(/\s+/g, '');

            if (id && !libraryMap.has(id) && (isAdmin || !seenTitles.has(titleKey))) {
                libraryMap.set(id, synced);
                seenTitles.add(titleKey);
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
    console.log(`📥 [LIBRARY ADD] Request:`, req.body);
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
        // Check if already in library
        const existingItemIndex = library.items.findIndex(item => 
            (item.productId && item.productId.toString() === product._id.toString()) ||
            (item._id && item._id.toString() === product._id.toString())
        );

        if (existingItemIndex > -1) {
            const existingItem = library.items[existingItemIndex];
            
            // If it's there but hidden or inactive, reactivate it!
            if (existingItem.accessStatus === 'hidden' || existingItem.accessStatus === 'inactive') {
                existingItem.accessStatus = 'active';
                existingItem.purchasedAt = new Date();
                library.markModified('items');
                await library.save();
                return res.json({ success: true, message: 'Product reactivated in library', library });
            }

            // Already in library and active - return success (idempotent)
            return res.json({ success: true, message: 'Product already in your library' });
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

router.delete('/my-library/:productId', protect, async (req, res) => {
    try {
        const { productId } = req.params;
        const user = req.user;
        const isAdmin = user.role === 'admin' || (user.email && user.email.toLowerCase() === 'admin@uwo24.com');

        console.log(`🗑️ REMOVE REQUEST: Product=${productId}, User=${user.email}, Admin=${isAdmin}`);

        if (isAdmin) {
            // Admin logic: Instead of removing from a collection they don't strictly "own" 
            // (since they override all products), we mark the item as 'hidden' in THEIR library.
            let library = await DigitalLibrary.findOne({ userId: user._id });
            if (!library) {
                console.log('Creating new library for admin');
                library = new DigitalLibrary({ userId: user._id, items: [] });
            }

            // Find if product already exists in their specific entries
            let item = library.items.find(i =>
                (i.productId && i.productId.toString() === productId) ||
                (i._id && i._id.toString() === productId)
            );

            if (item) {
                console.log('Marking existing item as hidden');
                item.accessStatus = 'hidden';
            } else {
                console.log('Creating new hidden entry for admin');
                if (!mongoose.Types.ObjectId.isValid(productId)) {
                    return res.status(400).json({ message: 'Invalid Product ID format for admin override' });
                }
                const product = await Product.findById(productId);
                if (product) {
                    library.items.push({
                        productId: product._id,
                        title: product.title,
                        type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                        thumbnail: product.thumbnail,
                        filePath: product.filePath,
                        accessStatus: 'hidden',
                        purchasedAt: new Date()
                    });
                } else {
                    return res.status(404).json({ message: 'Product not found' });
                }
            }

            await library.save();
            console.log('Admin library saved with hidden item');
            return res.json({ message: 'Item hidden from admin library', library });
        } else {
            // Normal user logic: standard $pull
            if (!mongoose.Types.ObjectId.isValid(productId)) {
                return res.status(400).json({ message: 'Invalid Product ID format' });
            }

            const updatedLib = await DigitalLibrary.findOneAndUpdate(
                { userId: user._id },
                { $pull: { items: { productId: new mongoose.Types.ObjectId(productId) } } },
                { new: true }
            );

            if (!updatedLib) {
                return res.status(404).json({ message: 'Library not found' });
            }
            return res.json({ message: 'Item removed from library', library: updatedLib });
        }
    } catch (error) {
        console.error('ERROR in DELETE /my-library:', error);
        res.status(500).json({
            message: 'Error removing from library',
            error: error.message,
            stack: error.stack
        });
    }
});

module.exports = router;
