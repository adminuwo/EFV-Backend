const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { User, Purchase, Product, UserProgress, DigitalLibrary, Order } = require('../models');

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
        const userObjId = getUserObjId(req.user);
        
        console.log(`🔍 [LIBRARY GET] Syncing for: ${userEmail} (ID: ${userObjId})`);

        // --- SELF-HEALING SYNC: Check Order History for Unlocked Digital Items ---
        let orders = await Order.find({
            $or: [{ userId: userObjId }, { userId: userObjId.toString() }, { "customer.email": userEmail }],
            status: { $in: ['Paid', 'Completed', 'Completed (Digital)'] }
        });

        const digitalFromOrders = [];
        orders.forEach(order => {
            (order.items || []).forEach(item => {
                if ((item.type || '').toUpperCase() === 'EBOOK' || (item.type || '').toUpperCase() === 'AUDIOBOOK') {
                    digitalFromOrders.push({
                        productId: item.productId,
                        title: item.title,
                        type: (item.type || '').toUpperCase() === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                        purchasedAt: order.createdAt || new Date(),
                        orderId: order.orderId
                    });
                }
            });
        });

        // 1. Fetch current library data
        let libraryData = await DigitalLibrary.findOne({ 
            $or: [{ userId: userObjId }, { userId: userObjId.toString() }]
        });
        
        if (!libraryData) {
            console.log(`✨ [LIBRARY GET] Initializing new record for ${userEmail}`);
            libraryData = new DigitalLibrary({ userId: userObjId, items: [] });
        }

        // 2. Automated Fulfillment Merge (Auto-Unlock Missing Items)
        let newlyUnlockedCount = 0;
        digitalFromOrders.forEach(di => {
             const pidStr = (di.productId || '').toString();
             if (pidStr && !libraryData.items.some(li => (li.productId || '').toString() === pidStr)) {
                 libraryData.items.push({
                     productId: di.productId,
                     title: di.title,
                     type: di.type,
                     purchasedAt: di.purchasedAt,
                     orderId: di.orderId,
                     accessStatus: 'active'
                 });
                 newlyUnlockedCount++;
             }
        });

        if (newlyUnlockedCount > 0) {
            console.log(`🛡️ [LIBRARY GET] Auto-Unlocked ${newlyUnlockedCount} legacy contents for ${userEmail}`);
            await libraryData.save();
        }

        let rawItems = libraryData.items || [];
        console.log(`📦 [LIBRARY GET] Final DB Count: ${rawItems.length} for ${userEmail}`);

        // 3. Robust Sync with Marketplace (already implemented below)
        const syncItemWithProduct = async (item) => {
            try {
                const pid = (item.productId || item.id || item._id || '').toString();
                if (!pid) return null;

                // Search by ID/LegacyID or fallback to Title/Type fuzzy matching
                let product = await Product.findOne({
                    $or: [{ _id: pid }, { legacyId: pid }]
                });

                if (!product && item.title) {
                    const cleanTitle = item.title.replace(/\(.*\)/, '').replace(/[™®]/g, '').trim();
                    product = await Product.findOne({
                        title: new RegExp(cleanTitle, 'i')
                    });
                }

                if (product) {
                    return {
                        productId: product._id.toString(),
                        title: product.title,
                        type: (product.type || 'EBOOK').toUpperCase() === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                        thumbnail: product.thumbnail || item.thumbnail,
                        filePath: product.filePath || item.filePath,
                        purchasedAt: item.purchasedAt || item.addedAt || item.createdAt || new Date(),
                        progress: item.progress || 0,
                        language: product.language || item.language || 'English',
                        isSynced: true
                    };
                }
                
                // Return original item if product link is broken (fallback)
                return {
                    ...item.toObject ? item.toObject() : item,
                    productId: pid,
                    purchasedAt: item.purchasedAt || new Date()
                };
            } catch (err) {
                console.error(`❌ [LIBRARY GET] Sync Error for item:`, err);
                return item;
            }
        };

        const results = await Promise.all(rawItems.map(syncItemWithProduct));

        // 3. Final Deduplication and Sorting
        const libraryMap = new Map();
        for (const item of results) {
            if (!item) continue;
            const key = item.productId || item.id;
            if (key && !libraryMap.has(key.toString())) {
                libraryMap.set(key.toString(), item);
            }
        }

        const library = Array.from(libraryMap.values());
        library.sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt));

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
        
        console.log(`📥 [LIBRARY ADD] Request received...`);

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

        // STRICT VALIDATION: Only digital products (EBOOK/AUDIOBOOK) allowed
        const pType = (product.type || '').toUpperCase();
        if (pType !== 'EBOOK' && pType !== 'AUDIOBOOK') {
            console.warn(`🚨 [LIBRARY ADD] Rejected Invalid Type: ${pType} | Product: ${product.title}`);
            return res.status(400).json({ success: false, message: 'Only digital products (E-Books & Audiobooks) can be added to your library.' });
        }

        // 2. Resolve user library
        const userObjId = getUserObjId(req.user);
        const userEmail = (req.user.email || '').toLowerCase().trim();
        if (!userObjId) return res.status(401).json({ success: false, message: 'User session invalid' });

        console.log(`📦 [LIBRARY ADD] Request: Product=${productId} | User=${userEmail} (ID: ${userObjId})`);

        let library = await DigitalLibrary.findOne({
            $or: [{ userId: userObjId }, { userId: userObjId.toString() }]
        });

        if (!library) {
            console.log(`✨ [LIBRARY ADD] Creating NEW library record for ${userEmail}`);
            library = new DigitalLibrary({ userId: userObjId, items: [] });
        }

        // 3. Deduplicate - remove item if it already exists with same productId
        const pidStr = product._id.toString();
        console.log(`📝 [LIBRARY ADD] Saving product: ${product.title} (${pidStr})`);

        library.items = library.items.filter(item => 
            (item.productId || '').toString() !== pidStr && 
            (item.id || '').toString() !== pidStr
        );

        // 4. Create new library item
        const libraryItem = {
            productId: product._id,
            title: product.title,
            type: (product.type || 'EBOOK').toUpperCase() === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
            thumbnail: product.thumbnail,
            filePath: product.filePath,
            purchasedAt: new Date(),
            accessStatus: 'active'
        };

        library.items.push(libraryItem);
        await library.save();

        console.log(`✅ [LIBRARY ADD] Successfully saved product: ${product.title} to DB for user: ${userEmail}`);
        res.status(201).json({ success: true, message: 'Product added to library successfully!' });
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
