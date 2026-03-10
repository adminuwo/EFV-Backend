const { Cashfree, CFEnvironment } = require('cashfree-pg');

const appId = (process.env.CASHFREE_APP_ID || '').trim();
const secretKey = (process.env.CASHFREE_SECRET_KEY || '').trim();

try {
    const cashfree = new Cashfree();
    cashfree.XClientId = appId;
    cashfree.XClientSecret = secretKey;
    cashfree.XEnvironment = CFEnvironment.PRODUCTION;
    cashfree.XApiVersion = "2023-08-01";

    console.log('Instance method check:', typeof cashfree.PGCreateOrder);
    
    async function run() {
        try {
            const resp = await cashfree.PGFetchOrder("test");
            console.log('Success:', resp.data);
        } catch (e) {
            console.log('Error status:', e.response ? e.response.status : 'No resp');
            console.log('Error headers:', e.response ? e.response.headers : 'No headers');
            console.log('Error data:', e.response ? e.response.data : e.message);
        }
    }
    run();
} catch (err) {
    console.log('Init error:', err);
}
