const { Partner, PartnerSale } = require('../models');

/**
 * Handles recording a sale for a partner when an order is successfully placed/verified.
 */
async function processPartnerSale(order, partnerRef) {
    if (!partnerRef || !partnerRef.partnerId) {
        console.warn(`⚠️ [PARTNER-SALE] Skipping: No partnerRef or partnerId for Order ${order.orderId}`);
        return;
    }

    try {
        const partner = await Partner.findById(partnerRef.partnerId);
        if (!partner) return;

        // 1. Create PartnerSale record (Detailed Tracking)
        await PartnerSale.create({
            partnerId: partner._id.toString(),
            orderId: order.orderId,
            customerName: order.customer.name,
            customerEmail: order.customer.email,
            productName: order.items.map(i => i.title).join(', '),
            totalPrice: order.totalAmount,
            couponCode: partnerRef.couponCode,
            commissionPercent: partnerRef.commissionPercent,
            commissionAmount: partnerRef.commissionAmount,
            paymentStatus: 'Unpaid',
            createdAt: new Date()
        });

        // 2. Update Partner Summary Totals
        partner.totalCommissionEarned = (partner.totalCommissionEarned || 0) + partnerRef.commissionAmount;
        await partner.save();

        console.log(`📈 Partner Sale Recorded: ${partner.name} earned ₹${partnerRef.commissionAmount} from Order ${order.orderId}`);
    } catch (err) {
        console.error('Error processing partner sale logic:', err);
    }
}

module.exports = { processPartnerSale };
