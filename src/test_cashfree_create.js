const { Cashfree, CFEnvironment } = require('cashfree-pg');
require('dotenv').config();

const appId = (process.env.CASHFREE_APP_ID || '').trim();
const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();

const cashfree = new Cashfree();
cashfree.XClientId = appId;
cashfree.XClientSecret = secretKey;
cashfree.XEnvironment = CFEnvironment.PRODUCTION;

async function run() {
    try {
        console.log('Creating order with default version...');
        const orderId = "TEST-ORDER-" + Date.now();
        const request = {
            "order_id": orderId,
            "order_amount": 1,
            "order_currency": "INR",
            "customer_details": {
                "customer_id": "test_id",
                "customer_phone": "9999999999",
                "customer_email": "test@example.com"
            }
        };
        const resp = await cashfree.PGCreateOrder(request);
        console.log('Order Successfully Created:', resp.data.cf_order_id);
    } catch (e) {
        console.log('Error data:', e.response ? e.response.data : e.message);
    }
}
run();
