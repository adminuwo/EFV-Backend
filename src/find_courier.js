const axios = require('axios');
require('dotenv').config({ path: '../.env' });

async function getBestCourier() {
    try {
        const loginRes = await axios.post('https://api.nimbuspost.com/v1/users/login', {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });
        const token = loginRes.data.data;

        const payload = {
            origin: "482001",
            destination: "482001",
            payment_type: "cod",
            order_amount: 100,
            weight: 500
        };

        const res = await axios.post('https://api.nimbuspost.com/v1/courier/serviceability', payload, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (res.data.status && res.data.data && res.data.data.length > 0) {
            console.log('BEST_COURIER_ID:' + res.data.data[0].id);
            console.log('BEST_COURIER_NAME:' + res.data.data[0].name);
        } else {
            console.log('NO_COURIER_FOUND');
        }

    } catch (error) {
        console.error('Error:', error.response?.data || error.message);
    }
}

getBestCourier();
