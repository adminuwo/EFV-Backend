const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function fixIndex() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected.');

        const db = mongoose.connection.db;
        const collection = db.collection('products');

        console.log('Fetching current indexes...');
        const indexes = await collection.indexes();
        console.log('Current indexes:', JSON.stringify(indexes, null, 2));

        const legacyIdIndex = indexes.find(idx => idx.name === 'legacyId_1');
        
        if (legacyIdIndex) {
            console.log('Dropping legacyId_1 index...');
            await collection.dropIndex('legacyId_1');
            console.log('Dropped.');
        } else {
            console.log('legacyId_1 index not found by name.');
            // Try searching by key
            const byKey = indexes.find(idx => idx.key && idx.key.legacyId === 1);
            if (byKey) {
                console.log(`Dropping index by key: ${byKey.name}...`);
                await collection.dropIndex(byKey.name);
                console.log('Dropped.');
            }
        }

        console.log('Cleaning up empty/null legacyIds...');
        // Remove legacyId field if it is null or empty string to avoid future sparse index issues
        const result = await collection.updateMany(
            { $or: [{ legacyId: null }, { legacyId: "" }] },
            { $unset: { legacyId: "" } }
        );
        console.log(`Updated ${result.modifiedCount} documents.`);

        console.log('Re-creating sparse index for legacyId (non-unique)...');
        await collection.createIndex({ legacyId: 1 }, { sparse: true });
        console.log('Index created successfully.');

        await mongoose.disconnect();
        console.log('Done.');
    } catch (error) {
        console.error('Error fixing index:', error);
        process.exit(1);
    }
}

fixIndex();
