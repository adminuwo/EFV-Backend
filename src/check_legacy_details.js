const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const collection = db.collection('products');
    
    const docsWithNull = await collection.find({ legacyId: null }).toArray();
    console.log(`Found ${docsWithNull.length} products with legacyId: null`);
    docsWithNull.forEach(d => {
        console.log(`- ID: ${d._id}, Title: ${d.title}`);
    });

    const docsWithNone = await collection.find({ legacyId: { $exists: false } }).toArray();
    console.log(`Found ${docsWithNone.length} products without legacyId field`);

    await mongoose.disconnect();
}
check();
