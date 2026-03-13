const axios = require('axios');
const NIMBUS_BASE_URL = 'https://api.nimbuspost.com/v1';

async function test(pincode) {
    const payload = {
        origin: "482008", // Warehouse Pincode
        destination: pincode,
        payment_type: "cod",
        order_amount: 581,
        weight: 500
    };

    console.log(`Checking ${pincode}...`);
    try {
        const response = await axios.post(`${NIMBUS_BASE_URL}/users/login`, {
            email: "contact@uwo24.com",
            password: "Password@123"
        });
        const token = response.data.data.trim();

        const s = await axios.post(`${NIMBUS_BASE_URL}/courier/serviceability`, payload, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const couriers = s.data.data.map(c => c.name);
        console.log(`Couriers for ${pincode}:`, couriers);
    } catch (e) { console.error("Error", e.message); }
}

test('492013');
test('482008');
