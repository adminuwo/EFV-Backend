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
            debugLog(`PROTECT FAIL: User ID ${decoded.id} not found in DB [URL: ${req.originalUrl}]`);
            return res.status(404).json({ message: 'User not found' });
        }

        debugLog(`PROTECT SUCCESS: User ${req.user.email} (${req.user.role || 'no-role'}) [URL: ${req.originalUrl}]`);
        next();
    } catch (error) {
        debugLog(`PROTECT ERROR: ${error.message} [URL: ${req.originalUrl}]`);
        res.status(401).json({ message: 'Unauthorized, token expired or invalid' });
    }
};

const validatePurchase = async (req, res, next) => {
    const { productId } = req.params;

    if (!req.user) {
        debugLog(`VALIDATE FAIL: req.user is missing [URL: ${req.originalUrl}]`);
        return res.status(401).json({ message: 'User authentication failed' });
    }

    const userId = req.user._id || req.user.id;
    const userIdStr = userId.toString();
    const userEmail = req.user.email;
    const userRole = req.user.role;

    debugLog(`VALIDATING: User=${userEmail}, ID=${userIdStr}, Role=${userRole}, Product=${productId} [URL: ${req.originalUrl}]`);

    try {
        // 1. Admin bypass
        if (userRole === 'admin' || (userEmail && userEmail.toLowerCase() === 'admin@uwo24.com')) {
            debugLog(`GRANT: Admin Bypass for ${userEmail}`);
            return next();
        }

        // 2. Resolve the MongoDB product ID
        let resolvedProductId = productId;
        const isObjectId = /^[a-f\d]{24}$/i.test(productId);
        if (!isObjectId) {
            const { Product } = require('../models');
            const product = await Product.findOne({ legacyId: productId });
            if (product) {
                resolvedProductId = product._id.toString();
            }
        }

        // 3. Check user's purchasedProducts array (FASTEST)
        if (req.user.purchasedProducts && Array.isArray(req.user.purchasedProducts)) {
            const hasMatch = req.user.purchasedProducts.some(p => {
                const pStr = p.toString();
                return pStr === productId || pStr === resolvedProductId;
            });
            if (hasMatch) {
                debugLog(`GRANT: purchasedProducts array match for ${userEmail} -> ${productId}`);
                return next();
            }
        }

        // 4. Digital Library (Robust check)
        // Try multiple ID formats for userId to handle legacy JSON vs MongoDB
        const library = await DigitalLibrary.findOne({ 
            $or: [{ userId: userId }, { userId: userIdStr }]
        });

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

        // 5. Purchase History
        const purchase = await Purchase.findOne({
            $or: [
                { userId: userId, productId: resolvedProductId },
                { userId: userId, productId: productId },
                { userId: userIdStr, productId: resolvedProductId },
                { userId: userIdStr, productId: productId }
            ]
        });

        if (purchase) {
            debugLog(`GRANT: Purchase record found for ${userEmail} -> ${productId}`);
            return next();
        }

        debugLog(`DENY: ${userEmail} does not own ${productId}`);
        return res.status(403).json({ message: 'Access denied: Content not purchased [REFRESH_REQUIRED]' });
    } catch (error) {
        debugLog(`ERROR: ${error.message} [URL: ${req.originalUrl}]`);
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
