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
            const orders = await Order.find({
                'partnerRef.partnerId': (partner._id || partner.id).toString(),
                status: { $nin: ['Cancelled', 'Failed'] }
            });

            const totalOrders = orders.length;
            const totalRevenue = orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
            const unpaidCommission = orders
                .filter(o => !o.partnerRef.commissionPaid)
                .reduce((sum, o) => sum + (o.partnerRef.commissionAmount || 0), 0);

            return {
                ...partner,
                stats: { totalOrders, totalRevenue, unpaidCommission }
            };
        }));

        res.json(partnersWithStats);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching partners' });
    }
});

/**
 * @route   POST /api/partners
 */
router.post('/', adminAuth, async (req, res) => {
    try {
        const { name, email, phone, company, notes } = req.body;
        const partner = await Partner.create({ name, email, phone, company, notes });
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
