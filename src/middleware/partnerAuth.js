const jwt = require('jsonwebtoken');
const { Partner } = require('../models');

const partnerAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'No partner token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret123');

        // Check if token matches a partner
        const partner = await Partner.findById(decoded.id);

        if (!partner) {
            return res.status(404).json({ message: 'Partner account not found' });
        }

        if (!partner.isActive) {
            return res.status(403).json({ message: 'Partner account is deactivated' });
        }

        req.partner = partner;
        next();
    } catch (error) {
        console.error('Partner Auth Error:', error);
        res.status(401).json({ message: 'Invalid or expired partner session' });
    }
};

module.exports = partnerAuth;
