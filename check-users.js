const mongoose = require('mongoose');
const { User, Order, Product } = require('./src/models');
require('dotenv').config({ path: './.env' });

async function check() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/efv-final');
    const users = await User.find({}, 'email role name');
    console.log('--- USERS ---');
    users.forEach(u => console.log(`${u.email} - ${u.role} - ${u.name}`));
    
    const orders = await Order.countDocuments();
    console.log('\n--- STATS ---');
    console.log('Orders:', orders);
    console.log('Products:', await Product.countDocuments());
    
    process.exit();
}
check();
