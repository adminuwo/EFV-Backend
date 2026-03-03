const axios = require('axios');
require('dotenv').config();

async function checkShipments() {
    try {
        const loginRes = await axios.post('https://api.nimbuspost.com/v1/users/login', {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });
        const token = loginRes.data.data;

        const res = await axios.get('https://api.nimbuspost.com/v1/shipments?status=booked', {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log('Booked Shipments:', JSON.stringify(res.data.data?.data?.slice(0, 3), null, 2));

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

checkShipments();
