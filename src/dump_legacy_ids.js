const { MongoClient } = require('mongodb');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function list() {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db();
    const collection = db.collection('products');
    
    const products = await collection.find({}).toArray();
    const out = products.map(p => ({
        id: p._id.toString(),
        title: p.title,
        legacyId: p.legacyId,
        hasLegacyId: Object.keys(p).includes('legacyId')
    }));
    
    fs.writeFileSync('legacy_ids.json', JSON.stringify(out, null, 2), 'utf8');
    console.log('Done writing legacy_ids.json');
    await client.close();
}
list();
