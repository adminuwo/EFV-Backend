const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function check() {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db();
    const collection = db.collection('products');
    
    const prod = await collection.findOne({ _id: new ObjectId("67d264f331770e1c0ccec8da") });
    console.log('Keys in document:', Object.keys(prod));
    console.log('legacyId value:', prod.legacyId);
    console.log('legacyId type:', typeof prod.legacyId);
    
    await client.close();
}
check();
