const axios = require('axios');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const NIMBUS_BASE_URL = 'https://api.nimbuspost.com/v1';
const AWB = '77714850964';

async function fixManifest() {
    try {
        console.log('🔑 Logging in...');
        const loginRes = await axios.post(`${NIMBUS_BASE_URL}/users/login`, {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });
        const token = loginRes.data.data;
        console.log('✅ Logged in');

        // First, check shipment status
        console.log(`\n🔍 Checking shipment status for AWB: ${AWB}`);
        try {
            const trackRes = await axios.get(`${NIMBUS_BASE_URL}/shipments/track/${AWB}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('📦 Shipment Status:', JSON.stringify(trackRes.data, null, 2));
        } catch (e) {
            console.log('Track check skipped:', e.response?.data || e.message);
        }

        // Try manifest with 'awbs' key (correct format)
        console.log(`\n📋 Generating Manifest for AWB: ${AWB}...`);
        const manifestRes = await axios.post(`${NIMBUS_BASE_URL}/shipments/manifest`, {
            awbs: [AWB]
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('📊 Manifest Result:', JSON.stringify(manifestRes.data, null, 2));

        if (manifestRes.data.status) {
            console.log('\n✅ SUCCESS! Manifest generated. Check NimbusPost dashboard now.');
        } else {
            // Try alternate key formats
            console.log('\n⚠️ First attempt failed. Trying with "awb" key...');
            const res2 = await axios.post(`${NIMBUS_BASE_URL}/shipments/manifest`, {
                awb: AWB
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log('📊 Attempt 2 Result:', JSON.stringify(res2.data, null, 2));
        }

    } catch (error) {
        console.error('❌ Error:', error.response?.data || error.message);
    }
}

fixManifest();
