const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkLogs() {
    try {
        console.log('Connecting to:', process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI);
        const { NotificationLog, Job, SystemSettings } = require('../src/models');
        
        console.log('\n--- SYSTEM SETTINGS ---');
        const settings = await SystemSettings.find();
        console.log(JSON.stringify(settings, null, 2));

        console.log('\n--- RECENT NOTIFICATION LOGS ---');
        const logs = await NotificationLog.find().sort({ createdAt: -1 }).limit(10);
        console.log(JSON.stringify(logs, null, 2));

        console.log('\n--- RECENT JOBS ---');
        const jobs = await Job.find().sort({ createdAt: -1 }).limit(10);
        console.log(JSON.stringify(jobs, null, 2));

        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

checkLogs();
