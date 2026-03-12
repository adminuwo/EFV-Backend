const axios = require("axios");

// global token
global.nimbusToken = "";

// login function with retry logic
async function generateNimbusToken(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const email = process.env.NIMBUS_EMAIL;
      const password = process.env.NIMBUS_PASSWORD;

      if (!email || !password) {
        console.log("❌ Nimbus Login skipped: Email or Password missing in .env");
        return;
      }

      console.log(`🔑 Attempting Nimbus Login (Attempt ${i + 1}/${retries})...`);
      const response = await axios.post(
        "https://api.nimbuspost.com/v1/users/login",
        {
          email: email,
          password: password,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000 // 10 second timeout
        }
      );

      if (response.data && response.data.data) {
        global.nimbusToken = response.data.data;
        console.log("✅ Nimbus Token Generated Successfully");
        return; // Success
      } else {
        console.log("⚠️ Nimbus response received but token (data.data) is missing:", response.data);
      }

    } catch (error) {
      console.log(`❌ Nimbus Login Attempt ${i + 1} Failed:`, error.response?.data || error.message);
      if (i < retries - 1) {
        console.log(`⏳ Retrying in 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
}

module.exports = generateNimbusToken;