const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const nimbusPostService = require('./services/nimbusPostService');
const fs = require('fs');

async function test() {
    let output = { logs: [], result: null, error: null };
    output.logs.push('--- Testing /shipments endpoint ---');

    try {
        const testPayload = {
            order_number: "TEST" + Date.now(),
            shipping_address: {
                first_name: "Test",
                last_name: "User",
                email: "test@example.com",
                phone: "9876543210",
                address: "Test Address, Sadar",
                city: "Jabalpur",
                state: "Madhya Pradesh",
                pincode: "482001",
                country: "India"
            },
            pickup_address: {
                name: "Office",
                address: "Jabalpur",
                city: "Jabalpur",
                state: "Madhya Pradesh",
                pincode: "482001",
                phone: "9876543210"
            },
            order_items: [{
                name: "Test Book",
                qty: 1,
                price: 10,
                sku: "test-sku"
            }],
            payment_type: "prepaid",
            order_total: 10,
            weight: 500,
            length: 10,
            breadth: 10,
            height: 10
        };

        output.logs.push('📦 Calling createShipment()...');
        const result = await nimbusPostService.createShipment(testPayload);
        output.result = result;
    } catch (err) {
        output.error = err.message;
    }
    fs.writeFileSync(path.join(__dirname, 'test_nimbus_result.json'), JSON.stringify(output, null, 2));
}

test();
