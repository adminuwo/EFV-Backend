const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const nimbusPostService = require('./services/nimbusPostService');
const fs = require('fs');

async function testAutomatedFlow() {
    console.log('--- Testing FULL Automated Nimbus Flow ---');

    const mockOrder = {
        orderId: "TEST-AUTO-" + Date.now(),
        totalAmount: 499
    };

    const mockAddress = {
        fullName: "Test User",
        email: "sreshthi+3296@uwo24.com",
        phone: "9876543210",
        house: "Test House 123",
        city: "Jabalpur",
        state: "Madhya Pradesh",
        pincode: "482001"
    };

    const mockItems = [{
        title: "Test Hardcover Book",
        quantity: 1,
        price: 499,
        weight: 500, // grams
        type: 'HARDCOVER'
    }];

    try {
        console.log('🚀 Calling automateShipping()...');
        const result = await nimbusPostService.automateShipping(mockOrder, mockAddress, mockItems, 'prepaid');

        console.log('🏆 Automated Flow Result:', JSON.stringify(result, null, 2));

        fs.writeFileSync(
            path.join(__dirname, 'test_nimbus_automation_result.json'),
            JSON.stringify(result, null, 2)
        );

        if (result.status) {
            console.log('✅ SUCCESS: Full shipping automation verified.');
        } else {
            console.error('❌ FAILED:', result.message);
        }
    } catch (err) {
        console.error('💥 CRITICAL ERROR:', err.message);
    }
}

testAutomatedFlow();
