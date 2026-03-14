const mongoose = require('mongoose');
const { Product } = require('./src/models');
require('dotenv').config();

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    const products = await Product.find({ type: { $in: ['EBOOK', 'AUDIOBOOK'] } });
    products.forEach(p => console.log(`Title: ${p.title} | Thumbnail: ${p.thumbnail}`));
    process.exit(0);
}
check();
