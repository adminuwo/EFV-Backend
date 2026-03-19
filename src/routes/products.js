const express = require('express');
const router = express.Router();
const { Product, DigitalLibrary, User } = require('../models');
const adminAuth = require('../middleware/adminAuth');

// Get all products (Public)
router.get('/', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching products' });
    }
});

// Bulk Create/Seed Products (Admin Only)
router.post('/bulk-create', adminAuth, async (req, res) => {
    try {
        const products = req.body;
        if (!Array.isArray(products)) {
            return res.status(400).json({ message: 'Payload must be an array of products' });
        }

        const stats = { created: 0, skipped: 0 };
        const results = [];

        for (const pData of products) {
            // Check if exists by legacyId or _id (if it looks like a string ID)
            const idToMatch = pData._id;
            const existing = await Product.findOne({ $or: [{ _id: idToMatch }, { legacyId: idToMatch }, { title: pData.title, type: pData.type }] });

            if (existing) {
                stats.skipped++;
                continue;
            }

            // Clean data for Mongo (ID handled by Mongo unless it's a legacy string ID)
            const newDoc = { ...pData };
            if (pData._id && pData._id.startsWith('efv_')) {
                // Keep the string ID for legacy products
            } else {
                delete newDoc._id; // Let Mongo generate _id
            }

            const product = await Product.create(newDoc);
            results.push(product);
            stats.created++;

            // Automatically add to admin's library if it's a digital product
            if (product.type === 'EBOOK' || product.type === 'AUDIOBOOK') {
                try {
                    const adminUser = await User.findOne({ email: /admin@uwo24\.com/i });
                    const targets = [req.user._id];
                    if (adminUser && adminUser._id.toString() !== req.user._id.toString()) {
                        targets.push(adminUser._id);
                    }
                    for (let userId of targets) {
                        let library = await DigitalLibrary.findOne({ userId: userId });
                        if (!library) library = new DigitalLibrary({ userId: userId, items: [] });
                        const exists = library.items.some(item => (item.productId && item.productId.toString() === product._id.toString()) || item.title === product.title);
                        if (!exists) {
                            library.items.push({
                                productId: product._id,
                                title: product.title,
                                type: product.type,
                                thumbnail: product.thumbnail,
                                filePath: product.filePath
                            });
                            await library.save();
                        }
                    }
                } catch (libErr) { console.error('Lib auto-add error:', libErr); }
            }
        }

        res.json({ message: 'Bulk creation complete', stats });
    } catch (error) {
        console.error('Bulk create error:', error);
        res.status(500).json({ message: 'Error during bulk creation' });
    }
});

// Bulk Delete All Products (Admin Only)
router.delete('/bulk-delete-all', adminAuth, async (req, res) => {
    try {
        await Product.deleteMany({});
        res.json({ message: 'All products deleted successfully' });
    } catch (error) {
        console.error('Bulk delete error:', error);
        res.status(500).json({ message: 'Error during bulk deletion' });
    }
});

// Get single product (Public)
router.get('/:id', async (req, res) => {
    try {
        let product = null;
        const id = req.params.id;

        // 1. Try as MongoDB ObjectId first
        const isObjectId = /^[a-f\d]{24}$/i.test(id);
        if (isObjectId) {
            product = await Product.findById(id);
        }

        // 2. If not found, try as raw _id (for legacy string IDs like "efv_v1_audiobook")
        if (!product) {
            product = await Product.findOne({ _id: id });
        }

        // 3. If still not found, try legacyId field
        if (!product) {
            product = await Product.findOne({ legacyId: id });
        }

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    } catch (error) {
        console.error('Fetch product error:', error);
        res.status(500).json({ message: 'Error fetching product' });
    }
});

// Create Product (Admin Only)
router.post('/', adminAuth, async (req, res) => {
    try {
        const {
            title, author, price, discountPrice, type, filePath,
            description, thumbnail, gallery, stock, discount,
            category, language, volume, weight, length, breadth, height, duration,
            totalChapters, chapters
        } = req.body;

        if (!title || !price || !type) {
            return res.status(400).json({ message: 'Title, Price, and Type are required' });
        }

        const fs = require('fs');
        const path = require('path');
        const debugLog = (msg) => {
            const logPath = path.join(__dirname, '..', 'data', 'debug.log');
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
        };

        debugLog(`Attempting to create product: ${title} (${type})`);

        const product = await Product.create({
            title, author, price, discountPrice, type, filePath,
            description, thumbnail, gallery, stock, discount,
            category, language, volume, weight, length, breadth, height, duration,
            totalChapters, chapters
        });

        console.log('📝 Created Product to DB:', product._id);

        // Automatically add to admin's library if it's a digital product
        if (type === 'EBOOK' || type === 'AUDIOBOOK') {
            try {
                // HARDCODE: Always ensure product goes to admin@uwo24.com
                const adminUser = await User.findOne({ email: /admin@uwo24\.com/i });
                const targets = [req.user._id];
                if (adminUser && adminUser._id.toString() !== req.user._id.toString()) {
                    targets.push(adminUser._id);
                }

                for (let userId of targets) {
                    let library = await DigitalLibrary.findOne({ userId: userId });
                    if (!library) {
                        library = new DigitalLibrary({ userId: userId, items: [] });
                    }

                    // Check if already in library
                    const exists = library.items.some(item => item.productId && item.productId.toString() === product._id.toString());
                    if (!exists) {
                        library.items.push({
                            productId: product._id,
                            title: product.title,
                            type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                            thumbnail: product.thumbnail,
                            filePath: product.filePath,
                            purchasedAt: new Date()
                        });
                        await library.save();
                        console.log(`✅ Auto-added to library for user: ${userId}`);
                    }
                }
            } catch (libErr) {
                console.error('Error adding to admin library:', libErr);
            }
        }

        /* 
        // 🔔 Broadcase Notification to ALL users about the new book
        try {
            const { User } = require('../models');
            const users = await User.find({});
            const notification = {
                _id: 'new-book-' + Date.now(),
                title: 'New Arrival! 📚',
                message: `"${product.title}" is now available in the marketplace. Check it out now!`,
                type: 'Digital',
                link: 'dashboard',
                isRead: false,
                createdAt: new Date().toISOString()
            };

            for (let user of users) {
                if (!user.notifications) user.notifications = [];
                user.notifications.unshift(notification);
                // Keep list small
                if (user.notifications.length > 50) user.notifications = user.notifications.slice(0, 50);
                await user.save();
            }
            console.log(`📢 Broadcase new book alert to ${users.length} users.`);
        } catch (noteErr) {
            console.error('Broadcast notification error:', noteErr);
        }
        */

        res.status(201).json(product);
    } catch (error) {
        console.error('Create product error:', error);
        try {
            const fs = require('fs');
            const path = require('path');
            const logPath = path.join(__dirname, '..', 'data', 'debug.log');
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] ❌ ERROR: ${error.stack}\n`);
        } catch (e) {}
        res.status(500).json({ message: 'Error creating product: ' + error.message });
    }
});

// Update Product (Admin Only)
router.put('/:id', adminAuth, async (req, res) => {
    try {
        const id = req.params.id;
        let product = null;

        // 1. Try to update by ObjectId first
        const isObjectId = /^[a-f\d]{24}$/i.test(id);
        if (isObjectId) {
            product = await Product.findByIdAndUpdate(id, req.body, { new: true });
        }

        // 2. Try raw _id (for string IDs)
        if (!product) {
            product = await Product.findOneAndUpdate({ _id: id }, req.body, { new: true });
        }

        // 3. Try legacyId field
        if (!product) {
            product = await Product.findOneAndUpdate({ legacyId: id }, req.body, { new: true });
        }

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // GLOBAL SYNC: Update this product in EVERY user's digital library
        if (product.type === 'EBOOK' || product.type === 'AUDIOBOOK') {
            try {
                const libraries = await DigitalLibrary.find({});
                let modifiedCount = 0;

                // HARDCODE: Explicitly ensure admin@uwo24.com has it
                const masterAdmin = await User.findOne({ email: 'admin@uwo24.com' });
                const masterAdminId = masterAdmin ? masterAdmin._id.toString() : null;

                for (let lib of libraries) {
                    let changed = false;
                    let found = false;

                    lib.items = lib.items.map(item => {
                        if (item.productId && item.productId.toString() === product._id.toString()) {
                            changed = true;
                            found = true;
                            return {
                                ...item,
                                title: product.title,
                                thumbnail: product.thumbnail,
                                filePath: product.filePath,
                                type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book'
                            };
                        }
                        return item;
                    });

                    // ADMIN SPECIFIC: If this is the current admin's library OR the hardcoded admin's library, ADD IT IF MISSING
                    const isCurrentAdmin = lib.userId && lib.userId.toString() === req.user._id.toString();
                    const isMasterAdmin = lib.userId && lib.userId.toString() === masterAdminId;

                    if ((isCurrentAdmin || isMasterAdmin) && !found) {
                        lib.items.push({
                            productId: product._id,
                            title: product.title,
                            type: product.type === 'AUDIOBOOK' ? 'Audiobook' : 'E-Book',
                            thumbnail: product.thumbnail,
                            filePath: product.filePath,
                            purchasedAt: new Date()
                        });
                        changed = true;
                    }

                    if (changed) {
                        await lib.save();
                        modifiedCount++;
                    }
                }
                console.log(`🌐 Global Library Sync: Updated ${modifiedCount} users for product ${product._id}`);
            } catch (syncErr) {
                console.error('❌ Global library sync error:', syncErr);
            }
        }

        console.log('📝 Updated Product in DB:', product._id);
        res.json(product);
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ message: 'Error updating product: ' + error.message });
    }
});

// Delete Product (Admin Only)
router.delete('/:id', adminAuth, async (req, res) => {
    console.log(`🗑️ Admin: Deleting Product Request for ID: ${req.params.id}`);
    try {
        const id = req.params.id;
        let product = null;

        const isObjectId = /^[a-f\d]{24}$/i.test(id);
        if (isObjectId) {
            product = await Product.findByIdAndDelete(id);
        }

        if (!product) {
            product = await Product.findOneAndDelete({ _id: id });
        }

        if (!product) {
            product = await Product.findOneAndDelete({ legacyId: id });
        }

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ message: 'Error deleting product' });
    }
});

module.exports = router;
