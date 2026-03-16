const mongoose = require('mongoose');
const { Product } = require('./src/models');
require('dotenv').config();

async function inspect() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/efv');
        console.log('Connected to DB');
        
        const products = await Product.find({});
        console.log(`Total Products: ${products.length}`);
        
        const types = products.map(p => p.type);
        const uniqueTypes = [...new Set(types)];
        console.log('Unique Types in DB:', uniqueTypes);
        
        const digital = products.filter(p => ['EBOOK', 'AUDIOBOOK'].includes(p.type));
        console.log(`Digital Products found: ${digital.length}`);
        
        digital.forEach(p => {
            console.log(`- ${p.title} (${p.type}) [${p._id}]`);
        });

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

inspect();
