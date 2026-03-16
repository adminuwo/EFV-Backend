const fetch = require('node-fetch'); // or use axios if installed, wait, native fetch is in node 18+

async function testPost() {
    try {
        const body = {
            title: "Admin Test Product",
            author: "Admin Test",
            type: "EBOOK",
            price: 50,
            description: "Test description"
        };
        const res = await fetch('http://localhost:8080/api/products', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }, // We don't have token, wait! Route might be protected.
            body: JSON.stringify(body)
        });
        const data = await res.json();
        console.log('Status:', res.status);
        console.log('Response:', data);
    } catch (err) {
        console.error(err);
    }
}
testPost();
