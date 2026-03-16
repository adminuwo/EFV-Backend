const mongoose = require('mongoose');
const { Partner, Coupon } = require('./src/models');

async function findPartner() {
    try {
        await mongoose.connect('mongodb+srv://admin_db_user:MfFFHn9m748LcYRY@efv.adnatm4.mongodb.net/?appName=EFV');
        const p = await Partner.findOne({ email: 'abha@uwo24.com' });
        if(p) {
            console.log('Partner Token in DB:', p.partner_token);
            const coupons = await Coupon.find({ partnerId: p._id.toString() });
            coupons.forEach(c => {
                console.log(`Coupon Code: ${c.code}, Active: ${c.isActive}`);
            });
        } else {
            console.log('Partner not found');
        }
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

findPartner();
