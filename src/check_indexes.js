const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const collection = db.collection('products');
    
    const count = await collection.countDocuments({ legacyId: null });
    console.log(`Products with legacyId === null: ${count}`);
    
    const docs = await collection.find({ legacyId: null }).toArray();
    docs.forEach(d => console.log(`- ${d.title} (${d._id})`));

    const indexes = await collection.indexes();
    console.log('Current indexes:', JSON.stringify(indexes, null, 2));
    
    await mongoose.disconnect();
}
check();
