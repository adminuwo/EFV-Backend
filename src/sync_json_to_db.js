const path = require('path');
const modelsPath = path.join(__dirname, 'models/index.js');
const { Product } = require(modelsPath);
const mongoose = require('mongoose');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function run() {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    
    const jsonPath = path.join(__dirname, 'data/products.json');
    const products = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    console.log(`Found ${products.length} products in JSON. Syncing...`);
    
    for (const p of products) {
        // Try to find if it exists by legacyId or _id matching the string
        let existing = await Product.findOne({
            $or: [
                { _id: (mongoose.Types.ObjectId.isValid(p._id) ? p._id : null) },
                { legacyId: p._id }
            ]
        });

        if (!existing && !mongoose.Types.ObjectId.isValid(p._id)) {
             // If it's a string ID, try finding by raw _id just in case
             existing = await Product.findOne({ _id: p._id });
        }

        const productData = { ...p };
        // If _id is not a valid ObjectId, move it to legacyId and let Mongo generate a new _id
        if (!mongoose.Types.ObjectId.isValid(p._id)) {
            productData.legacyId = p._id;
            delete productData._id;
        }

        if (existing) {
            console.log(`Updating: ${p.title}`);
            await Product.findByIdAndUpdate(existing._id, productData);
        } else {
            console.log(`Creating: ${p.title}`);
            await Product.create(productData);
        }
    }
    
    console.log('✅ Sync Complete');
    await mongoose.disconnect();
}
run().catch(console.error);
