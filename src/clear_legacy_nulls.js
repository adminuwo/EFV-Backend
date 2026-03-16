const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function clearNulls() {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const collection = db.collection('products');
    
    console.log('Searching for products with legacyId as literal null or empty string...');
    
    // Use $type to find literal nulls (Type 10)
    const nullDocs = await collection.find({ legacyId: { $type: 10 } }).toArray();
    console.log(`Found ${nullDocs.length} literal nulls.`);
    
    const emptyDocs = await collection.find({ legacyId: "" }).toArray();
    console.log(`Found ${emptyDocs.length} empty strings.`);

    const result = await collection.updateMany(
        { $or: [{ legacyId: { $type: 10 } }, { legacyId: "" }] },
        { $unset: { legacyId: "" } }
    );
    
    console.log(`Unset legacyId for ${result.modifiedCount} documents.`);
    
    await mongoose.disconnect();
}
clearNulls();
