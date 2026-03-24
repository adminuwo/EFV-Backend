const Razorpay = require('razorpay');
const crypto = require('crypto');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Create an order in Razorpay
 */
async function createRazorpayOrder({ amount, receipt, notes = {} }) {
    try {
        const options = {
            amount: Math.round(amount * 100), // amount in the smallest currency unit (paise for INR)
            currency: "INR",
            receipt: receipt,
            notes: notes
        };
        const order = await razorpay.orders.create(options);
        return order;
    } catch (error) {
        console.error('Razorpay Create Order Error:', error);
        throw error;
    }
}

/**
 * Verify Razorpay Payment Signature
 */
function verifyRazorpaySignature(orderId, paymentId, signature) {
    try {
        const body = orderId + "|" + paymentId;
        const expectedSignature = crypto
            .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest("hex");

        return expectedSignature === signature;
    } catch (error) {
        console.error('Razorpay Signature Verification Error:', error);
        return false;
    }
}

/**
 * Fetch Payment Details from Razorpay
 */
async function fetchRazorpayPayment(paymentId) {
    try {
        const payment = await razorpay.payments.fetch(paymentId);
        return payment;
    } catch (error) {
        console.error('Razorpay Fetch Payment Error:', error);
        throw error;
    }
}

module.exports = {
    createRazorpayOrder,
    verifyRazorpaySignature,
    fetchRazorpayPayment,
    razorpay // Export instance just in case
};
