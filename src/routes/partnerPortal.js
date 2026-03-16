const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Partner, Order, Coupon } = require('../models');
const partnerAuth = require('../middleware/partnerAuth');
const sendEmail = require('../utils/emailService');

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'secret123', { expiresIn: '365d' });
};

/**
 * @route   POST /api/partner-portal/otp
 * @desc    Check if partner exists and send OTP
 */
router.post('/otp', async (req, res) => {
    try {
        const { email, force } = req.body;
        if (!email) return res.status(400).json({ message: 'Email is required' });

        const partner = await Partner.findOne({ email });
        if (!partner) {
            return res.status(404).json({ message: 'Partner not found. Please contact Admin.' });
        }

        if (!partner.isActive) {
            return res.status(403).json({ message: 'This partner account is currently disabled.' });
        }

        // Check if user is already activated (has password)
        if (partner.isActivated && partner.password && !force) {
            return res.json({ 
                status: 'activated', 
                message: 'Account already verified. Please enter your password.',
                isActivated: true 
            });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const salt = await bcrypt.genSalt(10);
        partner.otp = await bcrypt.hash(otp, salt);
        partner.otpExpires = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 mins
        await partner.save();

        // Send OTP Email
        try {
            await sendEmail({
                email: partner.email,
                subject: 'Verify your Partner Account - EFV™',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #070B14; color: #fff; border: 1px solid #D4AF37; border-radius: 10px;">
                        <h2 style="color: #D4AF37; text-align: center;">EFV™ Partner Portal</h2>
                        <p>Use the following OTP code to verify your account or reset your access:</p>
                        <div style="background: rgba(212, 175, 55, 0.1); padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #D4AF37;">${otp}</span>
                        </div>
                        <p style="color: #ccc; font-size: 14px; text-align: center;">This code will expire in 5 minutes.</p>
                    </div>
                `
            });
            res.json({ message: 'OTP sent successfully to ' + email });
        } catch (emailError) {
            console.error('Partner OTP Email Error:', emailError);
            res.status(500).json({ message: 'Error sending OTP email' });
        }

    } catch (error) {
        console.error('Partner Portal OTP Request Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @route   POST /api/partner-portal/verify-otp
 * @desc    Verify OTP and return a temp token for password setup
 */
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

        const partner = await Partner.findOne({ email });
        if (!partner || !partner.otp || !partner.otpExpires) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        const expiry = new Date(partner.otpExpires).getTime();
        if (Date.now() > expiry) {
            return res.status(400).json({ message: 'OTP has expired' });
        }

        const isMatch = await bcrypt.compare(otp, partner.otp);
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect OTP' });
        }

        // OTP Valid -> Return temporary activation token
        const activationToken = jwt.sign(
            { id: partner._id, type: 'activate' },
            process.env.JWT_SECRET || 'secret123',
            { expiresIn: '15m' }
        );

        res.json({ activationToken });

    } catch (error) {
        console.error('Partner OTP Verify Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @route   POST /api/partner-portal/setup-password
 * @desc    Set password and activate partner account
 */
router.post('/setup-password', async (req, res) => {
    try {
        const { activationToken, password } = req.body;
        if (!activationToken || !password) {
            return res.status(400).json({ message: 'Token and password are required' });
        }

        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters' });
        }

        const decoded = jwt.verify(activationToken, process.env.JWT_SECRET || 'secret123');
        if (decoded.type !== 'activate') throw new Error('Invalid token type');

        const partner = await Partner.findById(decoded.id);
        if (!partner) return res.status(404).json({ message: 'Partner not found' });

        // Hash and Save Password
        const salt = await bcrypt.genSalt(10);
        partner.password = await bcrypt.hash(password, salt);
        partner.isActivated = true;
        partner.status = 'Verified'; // Updated to Verified
        partner.otp = null;
        partner.otpExpires = null;
        await partner.save();

        res.json({ message: 'Account activated successfully! Please login.' });

    } catch (error) {
        console.error('Partner Setup Password Error:', error);
        res.status(401).json({ message: 'Invalid or expired activation session' });
    }
});

/**
 * @route   POST /api/partner-portal/login
 * @desc    Final login using password
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

        const partner = await Partner.findOne({ email });
        if (!partner) return res.status(401).json({ message: 'Invalid credentials' });

        if (!partner.isActivated) {
            return res.status(403).json({ message: 'Account not activated. Please verify email first.' });
        }

        if (!partner.isActive) {
            return res.status(403).json({ message: 'Account is disabled by admin.' });
        }

        const isMatch = await bcrypt.compare(password, partner.password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

        res.json({
            _id: partner._id,
            name: partner.name,
            email: partner.email,
            token: generateToken(partner._id)
        });

    } catch (error) {
        console.error('Partner Login Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @route   GET /api/partner-portal/dashboard
 * @desc    Get partner's own sales data and stats
 */
router.get('/dashboard', partnerAuth, async (req, res) => {
    try {
        const partner = req.partner;
        // Calculate stats
        const partnerIdStr = partner._id.toString();
        const orders = await Order.find({
            $or: [
                { 'partnerRef.partnerId': partnerIdStr },
                { 'partnerRef.partnerId': partner._id } // Catch any potential direct ObjectId storage
            ],
            status: { $nin: ['Cancelled', 'Failed'] }
        }).sort({ createdAt: -1 });

        console.log(`📊 Dashboard: Found ${orders.length} orders for partner: ${partner.name} (${partnerIdStr})`);

        const totalSales = orders.length;
        const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
        const totalCommissionEarned = orders.reduce((sum, o) => sum + (o.partnerRef.commissionAmount || 0), 0);
        const unpaidCommission = orders
            .filter(o => !o.partnerRef.commissionPaid)
            .reduce((sum, o) => sum + (o.partnerRef.commissionAmount || 0), 0);

        // Fetch linked coupon - Use string comparison for IDs
        const partnerIdStr = partner._id.toString();
        console.log(`🔍 Dashboard: Fetching coupon for partnerId: ${partnerIdStr}`);
        
        const coupons = await Coupon.find({ partnerId: partnerIdStr });
        const coupon = coupons.find(c => c.isActive !== false); // Find first active or implicitly active
        
        if (coupon) {
            console.log(`✅ Coupon found: ${coupon.code}`);
        } else {
            console.log(`⚠️ No active coupon found for partner: ${partner.name}`);
        }

        res.json({
            partner: {
                name: partner.name,
                company: partner.company,
                partner_token: partner.partner_token
            },
            stats: {
                totalSales,
                totalRevenue,
                totalCommissionEarned,
                unpaidCommission
            },
            coupon: coupon ? {
                code: coupon.code,
                value: coupon.value,
                type: coupon.type,
                commissionPercent: coupon.commissionPercent
            } : null,
            sales: orders.map(o => ({
                orderId: o.orderId,
                customerName: o.customer.name,
                customerEmail: o.customer.email,
                items: o.items.map(i => i.title).join(', '),
                totalPaid: o.totalAmount,
                couponCode: o.couponCode,
                commissionEarned: o.partnerRef.commissionAmount,
                isPaid: o.partnerRef.commissionPaid,
                date: o.createdAt
            }))
        });

    } catch (error) {
        console.error('Partner Dashboard Error:', error);
        res.status(500).json({ message: 'Error loading dashboard' });
    }
});

module.exports = router;
