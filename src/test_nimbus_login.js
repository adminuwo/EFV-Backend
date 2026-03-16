const axios = require('axios');
require('dotenv').config({ path: 'f:/EFVFINAL/VHA/EFV-B/.env' });

async function testNimbus() {
    try {
        const email = process.env.NIMBUS_EMAIL;
        const password = process.env.NIMBUS_PASSWORD;
        console.log(`Testing with Email: ${email}`);

        const response = await axios.post(
            "https://api.nimbuspost.com/v1/users/login",
            { email, password }
        );

        if (response.data && response.data.data) {
            console.log("✅ Success! Token received:", response.data.data.substring(0, 10) + "...");
        } else {
            console.log("❌ Response received but data missing:", response.data);
        }
    } catch (error) {
        console.log("❌ Failed:", error.response?.data || error.message);
    }
}

testNimbus();
