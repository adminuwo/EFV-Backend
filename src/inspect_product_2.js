const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function check() {
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db();
    const collection = db.collection('products');
    
    const prod = await collection.findOne({ _id: "67d264f331770e1c0ccec8da" });
    if (prod) {
        console.log('Found product with string _id');
        console.log('Keys:', Object.keys(prod));
        console.log('legacyId:', prod.legacyId);
    } else {
        const prodObj = await collection.findOne({ _id: require('mongodb').ObjectId.createFromHexString("67d264f331770e1c0ccec8da") });
        if (prodObj) {
            console.log('Found product with ObjectId _id');
            console.log('Keys:', Object.keys(prodObj));
            console.log('legacyId:', prodObj.legacyId);
        } else {
            console.log('Not found with either string or ObjectId');
        }
    }
    
    await client.close();
}
check();
