const mongoose = require('mongoose');
const { Order } = require('./src/models');

async function checkOrders() {
    try {
        await mongoose.connect('mongodb+srv://admin_db_user:MfFFHn9m748LcYRY@efv.adnatm4.mongodb.net/?appName=EFV');
        const orders = await Order.find({ partnerRef: { $ne: null } });
        console.log('Orders with PartnerRef Count:', orders.length);
        if (orders.length > 0) {
            console.log('Sample PartnerRef:', JSON.stringify(orders[0].partnerRef, null, 2));
            console.log('Sample Order Coupon:', orders[0].couponCode);
        }
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

checkOrders();
