const axios = require("axios");

// global token
global.nimbusToken = "";

// login function
async function generateNimbusToken() {
  try {
    const email = process.env.NIMBUS_EMAIL;
    const password = process.env.NIMBUS_PASSWORD;

    if (!email || !password) {
      console.log("❌ Nimbus Login skipped: Email or Password missing in .env");
      return;
    }

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
      }
    );

    if (response.data && response.data.data) {
      global.nimbusToken = response.data.data;
      console.log("✅ Nimbus Token Generated Successfully");
    } else {
      console.log("⚠️ Nimbus response received but token (data.data) is missing:", response.data);
    }

  } catch (error) {
    console.log("❌ Nimbus Login Error:", error.response?.data || error.message);
  }
}

module.exports = generateNimbusToken;