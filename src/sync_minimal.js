const path = require('path');
const modelsPath = path.join(__dirname, 'models/index.js');
const { Product } = require(modelsPath);
const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function run() {
    console.log('Connecting to:', process.env.MONGO_URI);
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected.');

    const jsonPath = path.join(__dirname, 'data/products.json');
    const products = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    console.log(`Processing ${products.length} products...`);
    
    for (const p of products) {
        try {
            const legacyId = p._id;
            // Remove _id from data to let Mongo generate one, or if it's a valid ObjectId we can keep it
            const data = { ...p };
            delete data._id;
            data.legacyId = legacyId;

            // Upsert by legacyId
            const result = await Product.findOneAndUpdate(
                { legacyId: legacyId },
                data,
                { upsert: true, new: true }
            );
            console.log(`Synced: ${result.title} (legacyId: ${legacyId})`);
        } catch (err) {
            console.error(`Failed to sync ${p.title}:`, err.message);
        }
    }
    
    console.log('All done.');
    await mongoose.disconnect();
}
run().catch(console.error);
