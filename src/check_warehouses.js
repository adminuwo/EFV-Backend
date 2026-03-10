
const axios = require('axios');
require('dotenv').config({ path: 'f:/EFVFINAL/VHA/EFV-B/.env' });

const NIMBUS_BASE_URL = 'https://api.nimbuspost.com/v1';

async function listWarehouses() {
    try {
        console.log('🔑 Logging in...');
        const loginRes = await axios.post(`${NIMBUS_BASE_URL}/users/login`, {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });
        const token = loginRes.data.data.trim();

        console.log('📦 Fetching Warehouses...');
        const response = await axios.get(`${NIMBUS_BASE_URL}/warehouse`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log(JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

listWarehouses();
