const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const collection = db.collection('products');
    
    const countNull = await collection.countDocuments({ legacyId: null });
    const countEmpty = await collection.countDocuments({ legacyId: "" });
    const countExists = await collection.countDocuments({ legacyId: { $exists: true } });
    const total = await collection.countDocuments({});
    
    console.log(`Total products: ${total}`);
    console.log(`Products with legacyId null: ${countNull}`);
    console.log(`Products with legacyId empty string: ${countEmpty}`);
    console.log(`Products with legacyId exists (any value): ${countExists}`);
    
    const indexes = await collection.indexes();
    console.log('Indexes:', JSON.stringify(indexes, null, 2));
    
    await mongoose.disconnect();
}
check();
