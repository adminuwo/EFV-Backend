const axios = require('axios');
require('dotenv').config({ path: '../.env' });

async function getWarehouses() {
    try {
        const loginRes = await axios.post('https://api.nimbuspost.com/v1/users/login', {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });
        const token = loginRes.data.data;

        const whRes = await axios.get('https://api.nimbuspost.com/v1/warehouse', {
            headers: { Authorization: `Bearer ${token}` }
        });

        const warehouses = whRes.data.data;
        warehouses.forEach(w => {
            console.log(`WH_ID: ${w.id} | NAME: ${w.name} | PIN: ${w.pincode}`);
        });

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

getWarehouses();
