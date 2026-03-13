const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: 'f:/EFVFINAL/VHA/EFV-B/.env' });

async function test() {
    try {
        console.log('Connecting to:', process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected!');
        
        const { User } = require('f:/EFVFINAL/VHA/EFV-B/src/models');
        const email = 'devanshlantwaynir@gmail.com';
        const user = await User.findOne({ email });
        
        if (!user) {
            console.log('User not found');
        } else {
            console.log('Found user:', user.name);
            // Simulate the reset logic
            user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            console.log('Saving...');
            await user.save();
            console.log('Saved!');
        }
    } catch (err) {
        console.error('ERROR:', err);
    } finally {
        mongoose.connection.close();
    }
}
test();
