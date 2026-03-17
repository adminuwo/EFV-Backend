const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: './.env' });

const MONGO_URI = process.env.MONGO_URI;

// Load Mongoose models (force not using jsonAdapter by setting env to false momentarily)
process.env.USE_JSON_DB = 'false';
const models = require('./src/models/index');

const migrateCollection = async (modelName, jsonFileName) => {
    const Model = models[modelName];
    if (!Model) {
        console.log(`Skipping ${modelName} - not found in models`);
        return;
    }

    const jsonPath = path.join(__dirname, 'src', 'data', jsonFileName);
    if (!fs.existsSync(jsonPath)) {
        console.log(`Skipping ${jsonFileName} - file does not exist`);
        return;
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    if (!Array.isArray(data) || data.length === 0) {
        console.log(`Skipping ${jsonFileName} - empty or invalid`);
        return;
    }

    console.log(`Migrating ${data.length} records to ${modelName}...`);
    
    // Process records to fix IDs and references
    for (let record of data) {
        try {
            // Delete old internal DB IDs if it's identical string so it generates new ObjectId if needed, or if valid ObjectId, keep it
            let query = {};
            if (record._id && /^[0-9a-fA-F]{24}$/.test(record._id)) {
                query._id = record._id;
            } else if (record.email && modelName === 'User') {
                query.email = record.email;
            } else if (record.orderId && modelName === 'Order') {
                query.orderId = record.orderId;
            } else if (record.id) {
                // Ignore random string ids by deleting them, let mongoose create new ones
                if (!/^[0-9a-fA-F]{24}$/.test(record.id)) {
                    delete record.id;
                    delete record._id;
                }
            } else {
                 if (record._id && !/^[0-9a-fA-F]{24}$/.test(record._id)) {
                    delete record._id;
                 }
                 if (record.id && !/^[0-9a-fA-F]{24}$/.test(record.id)) {
                    delete record.id;
                 }
            }
            
            // Format dates
            for (let filterKey of ['createdAt', 'updatedAt', 'purchaseDate', 'payoutDate']) {
                if (record[filterKey] && typeof record[filterKey] === 'string') {
                    record[filterKey] = new Date(record[filterKey]);
                }
            }

            if (Object.keys(query).length > 0) {
                // Upsert
                await Model.findOneAndUpdate(query, { $set: record }, { upsert: true, new: true, strict: false });
            } else {
                // Create
                const newDoc = new Model(record);
                await newDoc.save({ validateBeforeSave: false });
            }
        } catch (e) {
            console.error(`Error migrating record in ${modelName}:`, e.message);
        }
    }
    console.log(`✅ Completed ${modelName}`);
};

const runMigration = async () => {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB. Starting migration...');

        await migrateCollection('User', 'users.json');
        await migrateCollection('Product', 'products.json');
        await migrateCollection('Order', 'orders.json');
        await migrateCollection('Coupon', 'coupons.json');
        await migrateCollection('Shipment', 'shipments.json');
        await migrateCollection('Partner', 'partners.json');
        await migrateCollection('PartnerSale', 'partner_sales.json');
        await migrateCollection('PartnerMessage', 'partner_messages.json');
        await migrateCollection('DigitalLibrary', 'digital_library.json');
        await migrateCollection('AudiobookProgress', 'audiobook_progress.json');

        console.log('🎉 Migration Completed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
};

runMigration();
