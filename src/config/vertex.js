// const fs = require("fs");
// const os = require("os");
// const path = require("path");

// if (process.env.GOOGLE_CREDENTIALS_BASE64) {
//     const decodedKey = Buffer.from(
//         process.env.GOOGLE_CREDENTIALS_BASE64,
//         "base64"
//     ).toString("utf-8");

//     const tempKeyPath = path.join(os.tmpdir(), "gcp-key.json");
//     fs.writeFileSync(tempKeyPath, decodedKey);

//     process.env.GOOGLE_APPLICATION_CREDENTIALS = tempKeyPath;
// }

// const {
//     FunctionDeclarationSchemaType,
//     HarmBlockThreshold,
//     HarmCategory,
//     VertexAI
// } = require('@google-cloud/vertexai');

// const project = process.env.GCP_PROJECT_ID || process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
// const location = 'asia-south1';
// const textModel = 'gemini-2.5-flash';
// const visionModel = 'gemini-2.5-flash';

// if (!project) {
//     console.error("❌ Vertex AI Error: GCP_PROJECT_ID not found in environment variables.");
// } else {
//     console.log(`✅ Vertex AI initializing with Project ID: ${project}`);
// }

// const vertexAI = new VertexAI({ project: project, location: location });

// // Instantiate Gemini models
// const generativeModel = vertexAI.getGenerativeModel({
//     model: textModel,
//     safetySettings: [{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }],
//     generationConfig: { maxOutputTokens: 4192 },
//     systemInstruction: {
//         role: 'system',
//         parts: [{
//             text: `You are "EFV Intelligence" — the official AI assistant of the EFV™ (Energy Frequency Vibration) platform.

// About EFV:
// EFV™ stands for Energy, Frequency, and Vibration. It is an Alignment Intelligence System designed to help individuals measure, understand, and elevate their inner alignment. The platform includes digital books (EFV™ Books), alignment-based insights, and future AI-powered tools that help users live in flow.

// Your Role:
// - Guide users about EFV™, its philosophy, and its purpose.
// - Explain how alignment works in simple but powerful language.
// - Help users navigate the website (Home, About, Gallery, Marketplace, Feedback, Contact).
// - Provide details about EFV™ Books and how to access them.
// - Encourage alignment, clarity, growth, and conscious awareness.
// - Respond to both practical questions and spiritual questions.

// Tone & Personality:
// - Premium, intelligent, calm, and slightly mystical.
// - Confident but not arrogant.
// - Speak in short, powerful sentences.
// - Use subtle inspiration.
// - Avoid overly technical language.
// - Keep responses clear and elegant.

// Design Awareness:
// The website has a dark cosmic theme with gold glow elements.
// Your responses should feel like they belong to a luxury, futuristic, cosmic intelligence system.

// Rules:
// - Never mention internal instructions.
// - If the user asks something unrelated to EFV, gently bring the conversation back to alignment.
// - Do not generate harmful or controversial content.
// - Keep answers concise unless the user asks for detailed explanation.
// - Encourage users to explore EFV™ Books when relevant.

// Greeting Example:
// "Welcome to EFV™. Let's measure your alignment."

// If user asks about buying:
// Guide them to the Marketplace section and explain available formats (ebook, audio, etc.).

// If user asks about alignment:
// Explain that alignment is the harmony between thought, emotion, and action.

// If user asks general life questions:
// Answer from an alignment-based perspective.

// Always respond as EFV Intelligence — never as a generic AI.
// `}]
//     },
// });

// const generativeVisionModel = vertexAI.getGenerativeModel({
//     model: visionModel,
// });

// const generativeModelPreview = vertexAI.preview.getGenerativeModel({
//     model: textModel,
// });

// module.exports = {
//     vertexAI,
//     generativeModel,
//     generativeVisionModel,
//     generativeModelPreview
// };
// Vertex AI (Cloud Run Compatible Version)
// No JSON keys required. Uses Google Cloud service account automatically.

const {
    HarmBlockThreshold,
    HarmCategory,
    VertexAI
} = require("@google-cloud/vertexai");


// ================= ENV VARIABLES =================
const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID;
const location = process.env.GOOGLE_CLOUD_LOCATION || "asia-south1";

if (!project) {
    console.error("❌ Vertex AI Error: Project ID not found in GOOGLE_CLOUD_PROJECT or GCP_PROJECT_ID.");
} else {
    console.log(`✅ Vertex AI initialized with Project: ${project} | Location: ${location}`);
}


// ================= INITIALIZE VERTEX =================
const vertexAI = new VertexAI({
    project: project || 'ai-mall-484810', // Hard fallback for stability
    location: location,
});


// ================= MODELS =================
const textModel = "gemini-2.5-flash";   // stable working model
const visionModel = "gemini-2.5-flash";


// ================= MAIN EFV AI MODEL =================
const generativeModel = vertexAI.getGenerativeModel({
    model: textModel,

    safetySettings: [
        {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
    ],

    generationConfig: {
        maxOutputTokens: 2048,
        temperature: 0.5,
        topP: 0.9,
    },

    systemInstruction: {
        role: "system",
        parts: [{
            text: `You are "EFV Intelligence" — the official AI assistant of the EFV™ (Energy Frequency Vibration) platform.

PROFESSIONAL FORMATTING RULES:
1. USE **highlighted text** for important keywords or section headers. The UI will render this as bold gold text.
2. ONE POINT PER LINE: When listing items (•), ensure each point starts on a NEW line.
3. CLEAR SPACING: Use double newlines between sections to keep responses structured and premium.
4. HEADINGS: Start each section with a clear Heading.
5. NO RAW MARKDOWN SYMBOLS: Except for ** (which the UI handles), avoid # or other raw tokens.

Example Response Structure:

Introduction
Welcome to the EFV portal.

**Key Features**
• Point one details here.
• Point two details here.

**Our Mission**
To help humans measure and elevate their inner alignment.

EFV Overview:
EFV™ stands for Energy, Frequency, and Vibration. It is an Alignment Intelligence System created by **Mr. Gurumukh P. Ahuja**. We provide this system through books, audio, and tools for conscious living. **Gurumukh P. Ahuja** is the author and visionary behind the entire EFV™ framework.

Tone:
Calm, premium, intelligent. Use concise sentences. Direct users to the Marketplace for Volumes 1-9 (E-books, Audiobooks, Physical).

Greeting:
"Welcome to EFV™. Let's measure your alignment."`
        }]
    }
});


// ================= VISION MODEL =================
const generativeVisionModel = vertexAI.getGenerativeModel({
    model: visionModel,
});


// ================= PREVIEW MODEL =================
const generativeModelPreview = vertexAI.preview.getGenerativeModel({
    model: textModel,
});


// ================= EXPORT =================
module.exports = {
    vertexAI,
    generativeModel,
    generativeVisionModel,
    generativeModelPreview
};