const { Cashfree, CFEnvironment } = require('cashfree-pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const cashfree = new Cashfree();
cashfree.XClientId = (process.env.CASHFREE_APP_ID || '').trim();
cashfree.XClientSecret = (process.env.CASHFREE_SECRET_KEY || '').trim();
cashfree.XEnvironment = process.env.CASHFREE_MODE === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;
cashfree.XApiVersion = "2023-08-01";

console.log('Testing Cashfree Authentication...');
console.log('App ID:', cashfree.XClientId);
console.log('Mode:', process.env.CASHFREE_MODE);
console.log('Environment:', cashfree.XEnvironment);

async function testAuth() {
    try {
        console.log('--- Calling Cashfree PG API ---');
        // Any valid PG API call will verify auth
        const response = await cashfree.PGFetchOrder("TEST_ORDER_NOT_FOUND");
        console.log('✅ Auth success (SDK returned something other than 401)');
        process.exit(0);
    } catch (error) {
        if (error.response) {
            console.log('❌ API Error Status:', error.response.status);
            console.log('❌ API Error Data:', JSON.stringify(error.response.data));
            if (error.response.data.message === 'authentication Failed') {
               console.log('🛑 AUTHENTICATION STILL FAILING! PLEASE VERIFY APP ID AND SECRET KEY IN .ENV');
            }
        } else {
            console.log('❌ Error:', error.message);
        }
        process.exit(1);
    }
}

testAuth();
