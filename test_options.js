const axios = require('axios');
async function test() {
    try {
        const res = await axios({
            method: 'OPTIONS',
            url: 'http://localhost:8080/api/orders/my-orders',
            headers: {
                'Origin': 'http://localhost:3000',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'Authorization'
            }
        });
        console.log('Status:', res.status);
        console.log('Headers:', res.headers);
    } catch (e) {
        if (e.response) {
            console.log('Status:', e.response.status);
            console.log('Headers:', e.response.headers);
        } else {
            console.error('Error:', e.message);
        }
    }
}
test();
