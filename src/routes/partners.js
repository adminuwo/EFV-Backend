console.log('🚀 Partners Route Module Loaded');
const express = require('express');
const router = express.Router();
const { Partner, Order, Coupon, PartnerSale } = require('../models');
const adminAuth = require('../middleware/adminAuth');

/**
 * @route   GET /api/partners
 * @desc    Get all partners with their quick stats
 */
router.get('/', adminAuth, async (req, res) => {
    try {
        const partners = await Partner.find().sort({ createdAt: -1 });

        const partnersWithStats = await Promise.all(partners.map(async (partner) => {
            // Ensure we have a plain object
            const partnerObj = JSON.parse(JSON.stringify(partner));
            
            const orders = await Order.find({
                'partnerRef.partnerId': (partnerObj._id || partnerObj.id).toString(),
                status: { $nin: ['Cancelled', 'Failed'] }
            });

            const totalOrders = orders.length;
            const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            const unpaidCommission = orders
                .filter(o => !o.partnerRef.commissionPaid)
                .reduce((sum, o) => sum + (o.partnerRef.commissionAmount || 0), 0);

            // Fetch all coupons for this partner using flexible ID matching
            const partnerIdStr = (partnerObj._id || partnerObj.id).toString();
            const allCoupons = await Coupon.find({ 
                $or: [
                    { partnerId: partnerIdStr },
                    { partnerId: partner._id } // Also try direct ObjectId if supported
                ]
            });
            
            // Debug: Log found counts
            // console.log(`🔍 Partner ${partnerObj.name}: Found ${allCoupons.length} total coupons`);
            
            // Filter for active ones in JS to be 100% sure about the boolean/string comparison
            const hasActiveCoupon = allCoupons.some(c => 
                (c.isActive === true || String(c.isActive) === 'true') && 
                (c.code.trim().toUpperCase() === (partnerObj.partner_token || '').trim().toUpperCase())
            );

            return {
                ...partnerObj,
                stats: { 
                    totalOrders, 
                    totalRevenue, 
                    unpaidCommission,
                    hasCoupon: hasActiveCoupon 
                }
            };
        }));
        
        res.json(partnersWithStats);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching partners' });
    }
});

const sendEmail = require('../utils/emailService');
const crypto = require('crypto');

/**
 * Generate a unique partner token
 */
async function generateUniqueToken(name) {
    const firstWord = name.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '');
    let token;
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 10) {
        // Random 3-4 digit number
        const randomNum = Math.floor(100 + Math.random() * 9000); 
        token = `${firstWord}-EFV-${randomNum}`;
        
        // Check uniqueness
        const existing = await Partner.findOne({ partner_token: token });
        if (!existing) {
            isUnique = true;
        }
        attempts++;
    }
    return token;
}

/**
 * @route   POST /api/partners
 */
router.post('/', adminAuth, async (req, res) => {
    try {
        const { name, email, phone, company, notes } = req.body;
        
        // Generate unique partner token (Marketing Token)
        const partner_token = await generateUniqueToken(name);
        
        // Generate invitation token
        const inviteToken = crypto.randomBytes(16).toString('hex');
        
        const partner = await Partner.create({ 
            name, 
            email, 
            phone, 
            company, 
            notes,
            token: inviteToken,
            partner_token, // Store the auto-generated marketing token
            status: 'Active',
            isActive: true,
            isActivated: false
        });

        // Send Invitation Email
        try {
            console.log(`📧 Sending invitation to: ${partner.email} with token: ${partner_token}`);
            await sendEmail({
                email: partner.email,
                subject: 'You have been invited to become an EFV Partner',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #d4af37; border-radius: 10px; background-color: #0a0a0a; color: #ffffff;">
                        <h2 style="color: #d4af37; text-align: center;">Welcome to EFV™ Partner Program</h2>
                        <p>Hello <strong>${partner.name}</strong>,</p>
                        <p>You have been invited to become an EFV Partner.</p>
                        <p>To activate your account:</p>
                        <ol style="line-height: 1.6;">
                            <li>Visit the EFV website</li>
                            <li>Scroll to the footer</li>
                            <li>Click <strong>Partner Portal</strong></li>
                            <li>Enter the same email address used for this invitation: <strong>${partner.email}</strong></li>
                        </ol>
                        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #333; font-size: 0.9rem; text-align: center; color: #888;">
                            &copy; 2026 EFV™ System. Designed for better living.
                        </div>
                    </div>
                `
            });
            console.log(`✅ Invitation sent to ${partner.email}`);
        } catch (emailErr) {
            console.error('❌ Failed to send invitation email:', emailErr);
            // Log full error for debugging
            console.error(emailErr.stack);
        }

        res.status(201).json(partner);
    } catch (error) {
        res.status(400).json({ message: 'Error creating partner: ' + error.message });
    }
});

/**
 * @route   POST /api/partners/:id/payout
 */
router.post('/:id/payout', adminAuth, async (req, res) => {
    try {
        const partnerId = req.params.id;
        const partner = await Partner.findById(partnerId);
        if (!partner) return res.status(404).json({ message: 'Partner not found' });

        // 1. Mark orders as paid
        const unpaidOrders = await Order.find({
            'partnerRef.partnerId': partnerId,
            'partnerRef.commissionPaid': false,
            status: { $nin: ['Cancelled', 'Failed'] }
        });

        let totalPaid = 0;
        for (let order of unpaidOrders) {
            totalPaid += (order.partnerRef.commissionAmount || 0);
            order.partnerRef.commissionPaid = true;
            await order.save();
        }

        // 2. Mark PartnerSale records as paid
        await PartnerSale.updateMany(
            { partnerId: partnerId.toString(), paymentStatus: 'Unpaid' },
            { paymentStatus: 'Paid', payoutDate: new Date() }
        );

        // 3. Update Partner Master record
        partner.totalCommissionPaid = (partner.totalCommissionPaid || 0) + totalPaid;
        await partner.save();

        res.json({ message: `Successfully paid ₹${totalPaid}`, totalPaid });
    } catch (error) {
        console.error('Payout error:', error);
        res.status(500).json({ message: 'Error processing payout' });
    }
});

/**
 * @route   GET /api/partners/:id/sales
 * @desc    Get all detailed sales for a partner (Admin view)
 */
router.get('/:id/sales', adminAuth, async (req, res) => {
    try {
        const sales = await PartnerSale.find({ partnerId: req.params.id }).sort({ createdAt: -1 });
        res.json(sales);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching partner sales' });
    }
});

/**
 * @route   DELETE /api/partners/:id
 */
router.delete('/:id', adminAuth, async (req, res) => {
    try {
        await Partner.findByIdAndDelete(req.params.id);
        await Coupon.updateMany({ partnerId: req.params.id }, { $set: { isActive: false } });
        res.json({ message: 'Partner removed' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting partner' });
    }
});

module.exports = router;
