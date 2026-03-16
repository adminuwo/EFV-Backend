const mongoose = require('mongoose');
const { Partner, Coupon } = require('./src/models');

async function findPartner() {
    try {
        await mongoose.connect('mongodb+srv://admin_db_user:MfFFHn9m748LcYRY@efv.adnatm4.mongodb.net/?appName=EFV');
        const partners = await Partner.find({ email: 'abha@uwo24.com' });
        console.log('PARTNER:', JSON.stringify(partners, null, 2));
        
        if (partners.length > 0) {
            const coupons = await Coupon.find({ partnerId: partners[0]._id.toString() });
            console.log('COUPONS:', JSON.stringify(coupons, null, 2));
        }
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

findPartner();
