require('dotenv').config();
const { generativeModel } = require('./config/vertex.js');

async function test() {
    try {
        const chat = generativeModel.startChat();
        const result = await chat.sendMessage("Hi");
        const response = result.response;
        console.log("AI Response:", response.candidates[0].content.parts[0].text);
    } catch (error) {
        console.error("❌ Vertex AI Failed!");
        console.error("Error Message:", error.message);
        console.error("Stack Trace:", error.stack);
        if (error.response) {
            console.error("Full Response Details:", JSON.stringify(error.response, null, 2));
        }
    }
}

test();
