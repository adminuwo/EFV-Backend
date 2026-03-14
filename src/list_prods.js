const { Product } = require('./src/models');
const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const ps = await Product.find({}, '_id title');
    console.log(JSON.stringify(ps, null, 2));
    await mongoose.disconnect();
}
run().catch(console.error);
