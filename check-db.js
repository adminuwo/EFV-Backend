const mongoose = require('mongoose');
const { Product, Order, User } = require('./src/models');
require('dotenv').config({ path: './.env' });

async function check() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/efv-final');
    console.log('Products:', await Product.countDocuments());
    console.log('Orders:', await Order.countDocuments());
    console.log('Users:', await User.countDocuments());
    process.exit();
}
check();
