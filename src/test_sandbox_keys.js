const { Cashfree, CFEnvironment } = require('cashfree-pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const cashfree = new Cashfree();
cashfree.XClientId = (process.env.CASHFREE_APP_ID || '').trim();
cashfree.XClientSecret = (process.env.CASHFREE_SECRET_KEY || '').trim();
// Force sandbox for this test
cashfree.XEnvironment = CFEnvironment.SANDBOX; 
cashfree.XApiVersion = "2023-08-01";

console.log('Testing Cashfree Sandbox Authentication...');
console.log('App ID:', cashfree.XClientId);

async function testAuth() {
    try {
        const response = await cashfree.PGFetchOrder("test_" + Date.now());
        console.log('✅ Auth success (SDK returned something other than 401)');
    } catch (error) {
        if (error.response) {
            console.log('❌ API Error Status:', error.response.status);
            console.log('❌ API Error Data:', JSON.stringify(error.response.data));
        } else {
            console.log('❌ Error:', error.message);
        }
    }
}

testAuth();
