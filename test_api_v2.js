const axios = require('axios');
async function test() {
    try {
        const res = await axios.get('http://localhost:8080/api/products');
        console.log('Status:', res.status);
        console.log('Content-Type:', res.headers['content-type']);
        console.log('Data Type:', typeof res.data);
    } catch (e) {
        console.error('Error:', e.message);
    }
}
test();
