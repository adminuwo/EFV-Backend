const jwt = require('jsonwebtoken');
const { User, Purchase, DigitalLibrary } = require('../models');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '..', 'data', 'auth_debug.log');
const debugLog = (msg) => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
};

const protect = async (req, res, next) => {
    let token = req.headers.authorization?.split(' ')[1] || req.query.token;

    if (!token) return res.status(401).json({ message: 'No token provided' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');
        req.user = await User.findById(decoded.id).select('-password');

        if (!req.user) {
            debugLog(`PROTECT FAIL: User ID ${decoded.id} not found in DB`);
            return res.status(404).json({ message: 'User not found' });
        }

        debugLog(`PROTECT SUCCESS: User ${req.user.email} (${req.user.role || 'no-role'})`);
        next();
    } catch (error) {
        debugLog(`PROTECT ERROR: ${error.message}`);
        res.status(401).json({ message: 'Unauthorized, token expired or invalid' });
    }
};

const validatePurchase = async (req, res, next) => {
    const { productId } = req.params;

    if (!req.user) {
        debugLog(`VALIDATE FAIL: req.user is missing`);
        return res.status(401).json({ message: 'User authentication failed' });
    }

    const userId = req.user._id || req.user.id;
    const userEmail = req.user.email;
    const userRole = req.user.role;

    debugLog(`VALIDATING: User=${userEmail}, Role=${userRole}, Product=${productId}`);

    try {
        // 1. Admin bypass
        if (userRole === 'admin' || (userEmail && userEmail.toLowerCase() === 'admin@uwo24.com')) {
            debugLog(`GRANT: Admin Bypass for ${userEmail}`);
            return next();
        }

        // 2. Resolve the MongoDB product ID (may be a legacy string like "efv_v1_audiobook")
        let resolvedProductId = productId;
        const isObjectId = /^[a-f\d]{24}$/i.test(productId);
        if (!isObjectId) {
            // It's a legacy string ID — find the product's MongoDB _id
            const { Product } = require('../models');
            const product = await Product.findOne({ legacyId: productId });
            if (product) {
                resolvedProductId = product._id.toString();
            }
            // Keep original string for legacy JSON DB purchase lookup too
        }

        // 3. Check Purchase History (try both legacy and resolved ID)
        const purchase = await Purchase.findOne({
            $or: [
                { userId: userId, productId: resolvedProductId },
                { userId: userId, productId: productId }
            ]
        });

        if (purchase) {
            debugLog(`GRANT: Purchase found for ${userEmail} -> ${productId}`);
            return next();
        }

        // 4. Digital Library
        const library = await DigitalLibrary.findOne({ userId: userId });
        if (library && library.items) {
            const hasAccess = library.items.some(item => {
                const itemProdId = item.productId || item.id || item._id;
                if (!itemProdId) return false;
                const itemStr = itemProdId.toString();
                return itemStr === productId || itemStr === resolvedProductId;
            });

            if (hasAccess) {
                debugLog(`GRANT: Library entry found for ${userEmail} -> ${productId}`);
                return next();
            }
        }

        // 5. Also check user's purchasedProducts array (legacy field)
        if (req.user.purchasedProducts && Array.isArray(req.user.purchasedProducts)) {
            if (req.user.purchasedProducts.includes(productId) || req.user.purchasedProducts.includes(resolvedProductId)) {
                debugLog(`GRANT: purchasedProducts array match for ${userEmail} -> ${productId}`);
                return next();
            }
        }

        debugLog(`DENY: ${userEmail} does not own ${productId}`);
        return res.status(403).json({ message: 'Access denied: Content not purchased [REFRESH_REQUIRED]' });
    } catch (error) {
        debugLog(`ERROR: ${error.message}`);
        res.status(500).json({ message: 'Server error during validation' });
    }
};

const admin = (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.email.toLowerCase() === 'admin@uwo24.com')) {
        next();
    } else {
        res.status(403).json({ message: 'Access denied: Admin only' });
    }
};

module.exports = { protect, validatePurchase, admin };
