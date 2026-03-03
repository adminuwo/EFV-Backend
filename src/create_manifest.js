const axios = require('axios');
require('dotenv').config({ path: '../.env' });

async function createManifest() {
    try {
        console.log('Logging in...');
        const loginRes = await axios.post('https://api.nimbuspost.com/v1/users/login', {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });

        const token = loginRes.data.data;
        console.log('Token fetched.');

        // AWB numbers as a comma-separated string based on common Nimbus API patterns
        const awbs = "77712193576,77712192913,14227850765371";

        console.log('Creating Manifest for AWBs:', awbs);

        const res = await axios.post('https://api.nimbuspost.com/v1/shipments/manifest', {
            awb: awbs
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log('Manifest API Result:', JSON.stringify(res.data, null, 2));

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

createManifest();
