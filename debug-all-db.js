const mongoose = require('mongoose');

async function debugAllDBs() {
    try {
        const conn = await mongoose.connect('mongodb+srv://admin_db_user:MfFFHn9m748LcYRY@efv.adnatm4.mongodb.net/?appName=EFV');
        const admin = conn.connection.db.admin();
        const dbs = await admin.listDatabases();
        
        for (const dbInfo of dbs.databases) {
            console.log(`\n--- DB: ${dbInfo.name} ---`);
            const db = conn.connection.useDb(dbInfo.name).db;
            const collections = await db.listCollections().toArray();
            console.log('Collections:', collections.map(c => c.name));
            
            if (collections.map(c => c.name).includes('orders')) {
                const orders = await db.collection('orders').find({}).limit(5).toArray();
                console.log(`Sample Orders in ${dbInfo.name}:`, JSON.stringify(orders.map(o => ({id: o.orderId, coupon: o.couponCode})), null, 2));
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

debugAllDBs();
