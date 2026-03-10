const { Cashfree, CFEnvironment } = require('cashfree-pg');
require('dotenv').config();

const appId = (process.env.CASHFREE_APP_ID || '').trim();
const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();

const cashfree = new Cashfree();
cashfree.XClientId = appId;
cashfree.XClientSecret = secretKey;
cashfree.XEnvironment = CFEnvironment.PRODUCTION;
// No XApiVersion set, let it use default

async function run() {
    try {
        console.log('Fetching order with default version...');
        const resp = await cashfree.PGFetchOrder("test");
        console.log('Success:', resp.data);
    } catch (e) {
        console.log('Error data:', e.response ? e.response.data : e.message);
    }
}
run();
