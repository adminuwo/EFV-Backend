const path = require('path');
const modelsPath = path.join(__dirname, 'models/index.js');
const { Product } = require(modelsPath);
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const ps = await Product.find({}, '_id title type');
    ps.forEach(p => {
        console.log(`ID: ${p._id} (${p._id.toString().length}) | Title: ${p.title}`);
    });
    await mongoose.disconnect();
}
run().catch(console.error);
