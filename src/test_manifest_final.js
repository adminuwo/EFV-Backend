const axios = require('axios');
require('dotenv').config();

async function manifest() {
    try {
        const loginRes = await axios.post('https://api.nimbuspost.com/v1/users/login', {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });
        const token = loginRes.data.data;

        // Try Array
        console.log('Attempting Manifest with array...');
        const res = await axios.post('https://api.nimbuspost.com/v1/shipments/manifest', {
            awb: ["77712193576", "77712192913", "14227850765371"]
        }, {
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log('Result:', JSON.stringify(res.data, null, 2));

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

manifest();
