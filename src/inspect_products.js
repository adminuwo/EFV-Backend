const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Product, User } = require('./models');

async function inspect() {
    try {
        const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
        if (!uri) {
            console.error('No MONGO_URI or MONGODB_URI found in .env');
            process.exit(1);
        }
        
        console.log(`Connecting to: ${uri.split('@')[1] || uri}`); // Don't log credentials
        await mongoose.connect(uri);
        console.log('Connected to DB');
        
        const adminEmail = 'admin@uwo24.com';
        const user = await User.findOne({ email: new RegExp(`^${adminEmail}$`, 'i') });
        console.log(`Checking Admin User (${adminEmail}):`, user ? `Found (Role: ${user.role}, ID: ${user._id})` : 'NOT FOUND');
        
        const products = await Product.find({});
        console.log(`Total Products in DB: ${products.length}`);
        
        const types = products.map(p => p.type);
        const uniqueTypes = [...new Set(types)];
        console.log('Unique Types in DB:', uniqueTypes);
        
        // Match the logic in library.js
        const digital = products.filter(p => /^(EBOOK|AUDIOBOOK|E-BOOK)$/i.test(p.type));
        console.log(`Digital Products found (using library logic): ${digital.length}`);
        
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
