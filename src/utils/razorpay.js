const Razorpay = require('razorpay');
const crypto  = require('crypto');

// ── Initialize Razorpay instance with LIVE credentials ──────────────────────
const razorpay = new Razorpay({
    key_id    : (process.env.RAZORPAY_KEY_ID     || '').trim(),
    key_secret: (process.env.RAZORPAY_KEY_SECRET || '').trim()
});

/**
 * Create a Razorpay order on the server.
 * @param {Object} opts
 * @param {number}  opts.amount       – Amount in PAISE (INR × 100)
 * @param {string}  opts.receipt      – Internal receipt / order-id string
 * @param {Object}  [opts.notes]      – Optional key-value metadata
 * @returns {Object} Razorpay order object (id, amount, currency…)
 */
const createRazorpayOrder = async ({ amount, receipt, notes = {} }) => {
    const options = {
        amount  : Math.round(amount * 100),   // Razorpay expects paise
        currency: 'INR',
        receipt : receipt,
        notes   : notes,
        payment_capture: 1                    // Auto-capture
    };

    console.log('--- Creating Razorpay Order ---');
    console.log(`Receipt: ${receipt} | Amount: ₹${amount} (${options.amount} paise)`);
    console.log(`Key ID : ${process.env.RAZORPAY_KEY_ID}`);

    const order = await razorpay.orders.create(options);
    console.log(`✅ Razorpay Order Created: ${order.id}`);
    return order;
};

/**
 * Verify the payment signature returned by Razorpay after checkout.
 * @param {string} razorpay_order_id   – From Razorpay
 * @param {string} razorpay_payment_id – From Razorpay
 * @param {string} razorpay_signature  – From Razorpay (HMAC-SHA256)
 * @returns {boolean} true if signature is valid
 */
const verifyRazorpaySignature = (razorpay_order_id, razorpay_payment_id, razorpay_signature) => {
    const body      = razorpay_order_id + '|' + razorpay_payment_id;
    const expected  = crypto
        .createHmac('sha256', (process.env.RAZORPAY_KEY_SECRET || '').trim())
        .update(body)
        .digest('hex');

    return expected === razorpay_signature;
};

/**
 * Fetch a specific payment's details from Razorpay (for extra server-side checks).
 * @param {string} paymentId
 * @returns {Object} Razorpay payment object
 */
const fetchRazorpayPayment = async (paymentId) => {
    return await razorpay.payments.fetch(paymentId);
};

module.exports = {
    createRazorpayOrder,
    verifyRazorpaySignature,
    fetchRazorpayPayment
};
