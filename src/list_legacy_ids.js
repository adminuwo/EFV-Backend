const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function list() {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db();
    const collection = db.collection('products');
    
    const products = await collection.find({}).toArray();
    console.log(`Checking ${products.length} products:`);
    products.forEach(p => {
        console.log(`- ${p.title}: legacyId = ${JSON.stringify(p.legacyId)} (keys: ${Object.keys(p).includes('legacyId')})`);
    });
    
    await client.close();
}
list();
