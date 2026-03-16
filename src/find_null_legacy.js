const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function find() {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const collection = db.collection('products');
    
    const prod = await collection.findOne({ legacyId: null });
    console.log('Product with legacyId null:', JSON.stringify(prod, null, 2));
    
    await mongoose.disconnect();
}
find();
