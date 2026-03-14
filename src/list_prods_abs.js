const path = require('path');
const modelsPath = path.join(__dirname, 'models/index.js');
const { Product } = require(modelsPath);
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const ps = await Product.find({}, '_id title type');
    console.log('--- START ---');
    ps.forEach(p => {
        console.log(`ID: ${p._id} | Title: ${p.title}`);
    });
    console.log('--- END ---');
    await mongoose.disconnect();
}
run().catch(console.error);
