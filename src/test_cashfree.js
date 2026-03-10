require('dotenv').config();
const { Cashfree, CFEnvironment } = require('cashfree-pg');

const appId = (process.env.CASHFREE_APP_ID || '').trim();
const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();
const mode = (process.env.CASHFREE_MODE || 'sandbox').trim().toLowerCase();

Cashfree.XClientId = appId;
Cashfree.XClientSecret = secretKey;
Cashfree.XEnvironment = mode === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
Cashfree.XApiVersion = "2023-08-01";

console.log('--- Cashfree Test ---');
console.log('App ID:', appId);
console.log('Mode:', mode);
console.log('Env Enum:', Cashfree.XEnvironment);

async function test() {
    try {
        console.log('Fetching order...');
        // Try to fetch a non-existent order to check auth
        const response = await Cashfree.PGOrderFetchPayments("test-order-123");
        console.log('Response:', response.data);
    } catch (error) {
        console.log('Error Status:', error.response ? error.response.status : 'No response');
        console.log('Error Data:', error.response ? error.response.data : error.message);
    }
}

test();
