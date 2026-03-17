const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function checkAllIndexes() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        
        for (let col of collections) {
            console.log(`\nIndexes for collection: ${col.name}`);
            const indexes = await db.collection(col.name).indexes();
            console.log(JSON.stringify(indexes, null, 2));
        }
        
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

checkAllIndexes();
