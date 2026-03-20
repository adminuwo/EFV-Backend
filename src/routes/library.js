const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { User, Purchase, Product, UserProgress, DigitalLibrary } = require('../models');

// Helper to get a consistent ObjectId for userId
function getUserObjId(user) {
    if (!user || (!user._id && !user.id)) return null;
    const id = user._id || user.id;
    
    // If it's already a valid ObjectId instance, return it
    if (mongoose.Types.ObjectId.isValid(id) && typeof id === 'object' && id.toString() === id.toHexString()) return id;
    
    // Try converting from string if valid hex, else just use the string (for Mixed type fields)
    if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) {
        return new mongoose.Types.ObjectId(id);
    }
    return id; // Return as is (string) if not a hex ID
}


// Get user's digital library
router.get('/test-ping', (req, res) => res.json({ message: 'Library Route v1.4 is ACTIVE', timestamp: new Date() }));

router.get('/my-library', protect, async (req, res) => {
    try {
        const userObjId = getUserObjId(req.user);
        let libraryData = await DigitalLibrary.findOne({ 
            $or: [{ userId: userObjId }, { userId: userObjId.toString() }]
        });
        let rawItems = libraryData ? (libraryData.items || []) : [];

        // Helper to sync an item with latest product data
        const syncItemWithProduct = async (item) => {
            try {
                const productId = (item.productId || item._id || item.id || '').toString();
                let product = null;

                // Try finding by ID first
                if (productId && mongoose.Types.ObjectId.isValid(productId)) {
                    product = await Product.findById(productId);
                }

                if (!product && productId) {
                   // Try searching by legacyId if not a valid ObjectId or not found
                   product = await Product.findOne({
                       $or: [{ _id: productId }, { legacyId: productId }]
                   });
                }

                // Fallback: Fuzzy matching by title
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
                return item;
            } catch (err) {
                console.error('Library Item Sync Error:', err);
                return item;
            }
        };

        // Use a Map to deduplicate by productId
        const libraryMap = new Map();

        for (const item of rawItems) {
            const synced = await syncItemWithProduct(item);
            const id = synced.productId?.toString();

            if (id && !libraryMap.has(id)) {
                libraryMap.set(id, synced);
            }
        }

        let library = Array.from(libraryMap.values());

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
        if (productId && typeof productId === 'string' && /^[0-9a-fA-F]{24}$/.test(productId)) {
            product = await Product.findById(productId);
        } else if (productId) {
            product = await Product.findOne({ _id: productId });
        }

        // 2. Fallback: Fuzzy matching by title
        if (!product) {
            const demoMap = {
                'efv_v1_ebook': { title: /^EFV™ VOL 1: ORIGIN CODE™$/i, type: 'EBOOK' },
                'efv_v1_audiobook': { title: /^EFV™ VOL 1: ORIGIN CODE™$/i, type: 'AUDIOBOOK' },
                'efv_v1_ebook_en': { title: /THE ORIGIN CODE/i, type: 'EBOOK' },
                'efv_v1_audiobook_en': { title: /THE ORIGIN CODE/i, type: 'AUDIOBOOK' },
                'efv_v2_ebook': { title: /MINDOS/i, type: 'EBOOK' },
                'efv_v2_audiobook': { title: /MINDOS/i, type: 'AUDIOBOOK' }
            };

            const demoSpec = demoMap[productId];
            if (demoSpec) {
                product = await Product.findOne({ title: demoSpec.title, type: demoSpec.type });
            }
        }

        if (!product) {
            return res.status(404).json({ success: false, message: `Product not found.`, receivedId: productId });
        }

        const userObjId = getUserObjId(req.user);
        if (!userObjId) return res.status(401).json({ success: false, message: 'User session invalid' });

        const libraryItem = {
            productId: product._id,
            title: product.title,
            type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
            thumbnail: product.thumbnail,
            filePath: product.filePath,
            purchasedAt: new Date(),
            accessStatus: 'active'
        };

        const result = await DigitalLibrary.findOneAndUpdate(
            { $or: [{ userId: userObjId }, { userId: userObjId.toString() }] },
            { 
                $setOnInsert: { userId: userObjId },
                $pull: { items: { productId: product._id } } 
            },
            { upsert: true, new: true }
        );

        await DigitalLibrary.findOneAndUpdate(
            { _id: result._id },
            { $push: { items: libraryItem } },
            { new: true }
        );

        res.status(201).json({ success: true, message: 'Product added to library successfully' });
    } catch (error) {
        console.error('Error adding to library:', error);
        res.status(500).json({ success: false, message: 'Error adding to library', error: error.message });
    }
});

router.delete('/my-library/all', protect, async (req, res) => {
    try {
        const user = req.user;
        const delUserObjId = getUserObjId(user);
        
        console.log(`🗑️ REMOVE ALL REQUEST: User=${user.email}`);

        const updatedLib = await DigitalLibrary.findOneAndUpdate(
            { $or: [{ userId: delUserObjId }, { userId: delUserObjId.toString() }] },
            { $set: { items: [] } },
            { new: true }
        );

        if (!updatedLib) {
            return res.status(404).json({ message: 'Library not found' });
        }
        return res.json({ message: 'All items permanently removed from library', library: updatedLib });

    } catch (error) {
        console.error('ERROR in DELETE /my-library/all:', error);
        res.status(500).json({ message: 'Error removing all from library', error: error.message });
    }
});

router.delete('/my-library/:productId', protect, async (req, res) => {
    try {
        const { productId } = req.params;
        const user = req.user;

        console.log(`🗑️ REMOVE REQUEST: Product=${productId}, User=${user.email}`);

        const delUserObjId = getUserObjId(user);
        
        const queryMatch = { $or: [{ userId: delUserObjId }, { userId: delUserObjId.toString() }] };
                
        const pulls = [productId];
        if (mongoose.Types.ObjectId.isValid(productId)) {
            pulls.push(new mongoose.Types.ObjectId(productId));
        }

        const updatedLib = await DigitalLibrary.findOneAndUpdate(
            queryMatch,
            { $pull: { items: { productId: { $in: pulls } } } },
            { new: true }
        );

        if (!updatedLib) {
            return res.status(404).json({ message: 'Library not found' });
        }
        return res.json({ message: 'Item permanently removed from library', library: updatedLib });

    } catch (error) {
        console.error('ERROR in DELETE /my-library:', error);
        res.status(500).json({ message: 'Error removing from library', error: error.message });
    }
});

module.exports = router;
