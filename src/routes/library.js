const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { User, Purchase, Product, UserProgress, DigitalLibrary } = require('../models');

// Helper to get a consistent identifier for userId (supports both ObjectId and custom Strings)
function getUserObjId(user) {
    if (!user) return null;
    const id = user._id || user.id;
    if (!id) return null;
    
    // If it's a valid 24-hex ObjectId, return it as one
    if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) {
        return new mongoose.Types.ObjectId(id);
    }
    
    // Fallback: return as-is (e.g. for custom IDs like 'admin-efv-001')
    return id.toString();
}


// Get user's digital library
router.get('/test-ping', (req, res) => res.json({ message: 'Library Route v1.5 is ACTIVE', timestamp: new Date() }));

router.get('/my-library', protect, async (req, res) => {
    try {
        const userEmail = (req.user.email || '').toLowerCase().trim();
        const isAdmin = req.user.role === 'admin' || userEmail === 'admin@uwo24.com';
        
        console.log(`🔍 [LIBRARY GET] Fetching for user: ${userEmail} | FullAccess: ${isAdmin}`);

        let results = [];

        if (isAdmin) {
            // --- FULL ACCESS FOR ADMINS ---
            // Automatically fetch all digital products from the database
            const allProducts = await Product.find({ 
                type: { $in: [/EBOOK/i, /AUDIOBOOK/i] }
            });
            
            console.log(`📚 [LIBRARY ADMIN] Granting full access to ${allProducts.length} marketplace products`);
            
            results = allProducts.map(product => ({
                productId: product._id.toString(),
                title: product.title,
                type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                thumbnail: product.thumbnail,
                filePath: product.filePath,
                purchasedAt: product.createdAt || new Date(),
                progress: 0,
                language: product.language || '',
                isFullAccessAdmin: true
            }));
        } else {
            // --- REGULAR USER LIBRARY ---
            const userObjId = getUserObjId(req.user);
            let libraryData = await DigitalLibrary.findOne({ 
                $or: [{ userId: userObjId }, { userId: userObjId.toString() }]
            });
            
            let rawItems = libraryData ? (libraryData.items || []) : [];
            console.log(`📦 [LIBRARY USER] Found ${rawItems.length} raw items in DB for ${userEmail}`);

            // Helper to sync an item with latest product data
            const syncItemWithProduct = async (item) => {
                try {
                    const searchId = (item.productId || item._id || item.id || '').toString();
                    if (!searchId) return null;

                    let product = await Product.findOne({
                        $or: [{ _id: searchId }, { legacyId: searchId }]
                    });

                    if (!product) {
                        const searchTitle = (item.title || item.name || '').replace(/\(.*\)/, '').trim();
                        if (searchTitle) {
                            product = await Product.findOne({
                                title: new RegExp(searchTitle.replace(/[™®]/g, '').trim(), 'i')
                            });
                        }
                    }

                    if (product) {
                        return {
                            productId: product._id.toString(),
                            title: product.title,
                            type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                            thumbnail: product.thumbnail || item.thumbnail,
                            filePath: product.filePath || item.filePath,
                            purchasedAt: item.purchasedAt || item.createdAt || new Date(),
                            progress: item.progress || 0,
                            language: product.language || item.language || ''
                        };
                    }
                    
                    return {
                        ...item.toObject ? item.toObject() : item,
                        productId: searchId,
                        purchasedAt: item.purchasedAt || item.createdAt || new Date()
                    };
                } catch (err) {
                    console.error(`❌ [LIBRARY USER] Error syncing ${item.title}:`, err);
                    return item;
                }
            };

            results = await Promise.all(rawItems.map(syncItemWithProduct));
        }

        // Final deduplication and sorting
        const libraryMap = new Map();
        for (const item of results) {
            if (!item) continue;
            const key = (item.productId || '').toString();
            if (key && !libraryMap.has(key)) {
                libraryMap.set(key, item);
            }
        }

        const library = Array.from(libraryMap.values());
        library.sort((a, b) => new Date(b.purchasedAt || 0) - new Date(a.purchasedAt || 0));

        console.log(`✅ [LIBRARY GET] Success. Returning ${library.length} items to ${userEmail}`);
        res.json(library);
    } catch (error) {
        console.error('❌ [LIBRARY GET] Global Error:', error);
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
        const userEmail = req.user.email;
        
        console.log(`📥 [LIBRARY ADD] User: ${userEmail} | Product: ${productId}`);

        let product = null;

        // 1. Resolve product
        if (productId && /^[0-9a-fA-F]{24}$/.test(productId.toString())) {
            product = await Product.findById(productId);
        }
        
        if (!product && productId) {
            product = await Product.findOne({
                $or: [{ _id: productId }, { legacyId: productId.toString() }]
            });
        }

        if (!product) {
            console.warn(`❌ [LIBRARY ADD] Product Not Found: ${productId}`);
            return res.status(404).json({ success: false, message: `Product not found.` });
        }

        // 2. Resolve user library
        const userObjId = getUserObjId(req.user);
        if (!userObjId) return res.status(401).json({ success: false, message: 'User session invalid' });

        let library = await DigitalLibrary.findOne({
            $or: [{ userId: userObjId }, { userId: userObjId.toString() }]
        });

        if (!library) {
            console.log(`🏠 [LIBRARY ADD] Creating new library for user: ${userEmail}`);
            library = new DigitalLibrary({ userId: userObjId, items: [] });
        }

        // 3. Deduplicate - remove item if it already exists with same productId
        const pidStr = product._id.toString();
        library.items = library.items.filter(item => 
            (item.productId || '').toString() !== pidStr && 
            (item.id || '').toString() !== pidStr
        );

        // 4. Create new library item
        const libraryItem = {
            productId: product._id,
            title: product.title,
            type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
            thumbnail: product.thumbnail,
            filePath: product.filePath,
            purchasedAt: new Date(),
            accessStatus: 'active'
        };

        library.items.push(libraryItem);
        await library.save();

        console.log(`✅ [LIBRARY ADD] Successfully added "${product.title}" to ${userEmail}'s library`);
        res.status(201).json({ success: true, message: 'Product added to library successfully' });
    } catch (error) {
        console.error('❌ [LIBRARY ADD] Error:', error);
        res.status(500).json({ success: false, message: 'Internal server error while adding to library', error: error.message });
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
