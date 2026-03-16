const mongoose = require('mongoose');
const { Order } = require('./src/models');

async function checkOrders() {
    try {
        await mongoose.connect('mongodb+srv://admin_db_user:MfFFHn9m748LcYRY@efv.adnatm4.mongodb.net/?appName=EFV');
        const orders = await Order.find({}).sort({createdAt: -1}).limit(10);
        console.log('Last 10 Orders:', JSON.stringify(orders.map(o => ({ 
            id: o.orderId, 
            coupon: o.couponCode, 
            partner: o.partnerRef, 
            total: o.totalAmount,
            status: o.status,
            createdAt: o.createdAt
        })), null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

checkOrders();
