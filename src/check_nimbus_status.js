const axios = require('axios');
require('dotenv').config({ path: '../.env' });

async function getShipmentDetails() {
    try {
        console.log('Logging in...');
        const loginRes = await axios.post('https://api.nimbuspost.com/v1/users/login', {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });

        const token = loginRes.data.data;
        console.log('Token fetched.');

        // Get info about the AWBs
        const awbs = ["77712193576", "77712192913", "14227850765371"];

        for (const awb of awbs) {
            console.log(`Checking AWB: ${awb}`);
            const res = await axios.get(`https://api.nimbuspost.com/v1/shipments/track/${awb}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            console.log(`Status for ${awb}:`, res.data.data?.status || res.data.message);
        }

        // Also check warehouses
        const whRes = await axios.get('https://api.nimbuspost.com/v1/warehouse', {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Warehouses:', JSON.stringify(whRes.data.data, null, 2));

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

getShipmentDetails();
