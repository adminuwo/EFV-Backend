const axios = require('axios');
require('dotenv').config({ path: '../.env' });

async function testServiceability() {
    try {
        console.log('Logging in...');
        const loginRes = await axios.post('https://api.nimbuspost.com/v1/users/login', {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });

        const token = loginRes.data.data;
        console.log('Token fetched.');

        const payload = {
            origin: "482001",
            destination: "482001",
            payment_type: "cod",
            order_amount: 100,
            weight: 500
        };

        console.log('Checking serviceability...');
        const res = await axios.post('https://api.nimbuspost.com/v1/courier/serviceability', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log('Serviceability Result:', JSON.stringify(res.data, null, 2));

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

testServiceability();
