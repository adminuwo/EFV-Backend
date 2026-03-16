const mongoose = require('mongoose');

async function debugDB() {
    try {
        const client = await mongoose.connect('mongodb+srv://admin_db_user:MfFFHn9m748LcYRY@efv.adnatm4.mongodb.net/?appName=EFV');
        const admin = mongoose.connection.db.admin();
        const dbs = await admin.listDatabases();
        console.log('Databases:', dbs.databases.map(d => d.name));
        
        console.log('Current DB:', mongoose.connection.db.databaseName);
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log('Collections in current DB:', collections.map(c => c.name));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

debugDB();
