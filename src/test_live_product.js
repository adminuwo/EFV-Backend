const https = require('https');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Test: Login as admin and add a product to the LIVE server
const API_BASE = 'https://efvbackend-743928421487.asia-south1.run.app';

async function run() {
    const fetch = (await import('node-fetch')).default;

    // 1. Login as admin
    const loginRes = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@uwo24.com', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    if (!loginRes.ok) {
        console.error('❌ Login failed:', loginData);
        return;
    }
    const token = loginData.token;
    console.log('✅ Login OK, token:', token ? 'obtained' : 'missing');

    // 2. Try to create a product
    const prod = {
        title: 'Test Product DELETE ME',
        type: 'HARDCOVER',
        price: 100,
        stock: 5,
        language: 'Hindi',
        category: 'Physical'
    };
    const createRes = await fetch(`${API_BASE}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(prod)
    });
    const createData = await createRes.json();
    if (createRes.ok) {
        console.log('✅ Product created successfully:', createData._id);
        // Clean up - delete the test product
        const delRes = await fetch(`${API_BASE}/api/products/${createData._id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        console.log('🗑️ Cleanup delete status:', delRes.status);
    } else {
        console.error('❌ Product creation FAILED:', createData);
    }
}

run().catch(console.error);
