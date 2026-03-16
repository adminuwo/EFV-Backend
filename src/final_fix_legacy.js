const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function clear() {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db();
    const collection = db.collection('products');
    
    console.log('Fetching all products to inspect legacyId...');
    const products = await collection.find({}).toArray();
    
    let fixCount = 0;
    for (const p of products) {
        if (p.hasOwnProperty('legacyId') && (p.legacyId === null || p.legacyId === "")) {
            console.log(`Fixing product: ${p.title} (${p._id})`);
            await collection.updateOne({ _id: p._id }, { $unset: { legacyId: "" } });
            fixCount++;
        }
    }
    
    console.log(`Done. Fixed ${fixCount} products.`);
    await client.close();
}
clear();
