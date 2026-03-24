const { PartnerSale } = require('../models');

/**
 * Process a sale linked to a partner
 * Creates a PartnerSale record and performs any necessary updates
 */
async function processPartnerSale(order, partnerRef) {
    try {
        if (!partnerRef || !partnerRef.partnerId) {
            console.warn('⚠️ processPartnerSale called without valid partnerRef');
            return null;
        }

        console.log(`💰 Processing Partner Sale record for Order: ${order.orderId}, Partner: ${partnerRef.partnerName}`);

        const saleRecord = await PartnerSale.create({
            partnerId: partnerRef.partnerId,
            orderId: order.orderId,
            customerName: order.customer.name,
            customerEmail: order.customer.email,
            productName: order.items.map(i => i.title).join(', '),
            totalPrice: order.totalAmount,
            couponCode: partnerRef.couponCode,
            commissionPercent: partnerRef.commissionPercent,
            commissionAmount: partnerRef.commissionAmount,
            paymentStatus: order.paymentStatus === 'Paid' ? 'Unpaid' : 'Unpaid' // Usually wait for payout
        });

        return saleRecord;
    } catch (error) {
        console.error('❌ Error processing partner sale:', error);
        throw error;
    }
}

module.exports = {
    processPartnerSale
};
