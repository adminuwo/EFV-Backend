const axios = require('axios');
require('dotenv').config({ path: '../.env' });

async function checkNimbus() {
    try {
        console.log('Logging in...');
        const loginRes = await axios.post('https://api.nimbuspost.com/v1/users/login', {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });

        const token = loginRes.data.data;
        console.log('Token fetched.');

        console.log('Fetching Warehouses...');
        const whRes = await axios.get('https://api.nimbuspost.com/v1/accounts/warehouses', {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log('Warehouses:', JSON.stringify(whRes.data, null, 2));

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

checkNimbus();
