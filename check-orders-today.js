const mongoose = require('mongoose');
const { Order } = require('./src/models');

async function checkOrders() {
    try {
        await mongoose.connect('mongodb+srv://admin_db_user:MfFFHn9m748LcYRY@efv.adnatm4.mongodb.net/?appName=EFV');
        const orders = await Order.find({ createdAt: { $gte: new Date('2026-03-16T00:00:00Z') } });
        console.log('Today Orders Count:', orders.length);
        console.log('Orders Details:', JSON.stringify(orders.map(o => ({ 
            id: o.orderId, 
            coupon: o.couponCode, 
            partner: o.partnerRef, 
            total: o.totalAmount,
            status: o.status
        })), null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

checkOrders();
