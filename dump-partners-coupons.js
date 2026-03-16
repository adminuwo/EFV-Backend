const mongoose = require('mongoose');
const { Partner, Coupon, Order } = require('./src/models');

async function dumpPartners() {
    try {
        await mongoose.connect('mongodb+srv://admin_db_user:MfFFHn9m748LcYRY@efv.adnatm4.mongodb.net/?appName=EFV');
        const partners = await Partner.find({});
        console.log('--- ALL PARTNERS ---');
        console.log(JSON.stringify(partners, null, 2));
        
        const coupons = await Coupon.find({});
        console.log('\n--- ALL COUPONS ---');
        console.log(JSON.stringify(coupons, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

dumpPartners();
