const fs = require('fs');
const path = require('path');
const axios = require('axios');

// LIVE API BASE
const LIVE_API = 'https://efvbackend-743928421487.asia-south1.run.app';
const LOCAL_USERS_PATH = path.join(__dirname, '..', 'data', 'users.json');

// Admin Credentials for Live Site (Please ensure these are correct)
const ADMIN_EMAIL = 'admin@uwo24.com';
const ADMIN_PASSWORD = process.argv[2]; // Pass via command line: node sync.js YOUR_PASSWORD

async function syncUsers() {
    if (!ADMIN_PASSWORD) {
        console.error('❌ Error: Please provide the admin password as an argument.');
        console.log('Usage: node src/scripts/syncLiveUsers.js YOUR_ADMIN_PASSWORD');
        return;
    }

    try {
        console.log(`🔌 Connecting to Live Server: ${LIVE_API}...`);

        // 1. Login to Live Server
        const loginRes = await axios.post(`${LIVE_API}/api/auth/login`, {
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD
        });

        const token = loginRes.data.token;
        console.log('✅ Logged in to Live Server. Syncing users...');

        // 2. Fetch Users from Live Server
        const usersRes = await axios.get(`${LIVE_API}/api/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const liveUsers = usersRes.data;
        console.log(`📊 Found ${liveUsers.length} users on live server.`);

        // 3. Read Local Users
        let localUsers = [];
        if (fs.existsSync(LOCAL_USERS_PATH)) {
            const data = fs.readFileSync(LOCAL_USERS_PATH, 'utf8');
            localUsers = JSON.parse(data);
        }

        // 4. Merge Users (Avoid duplicates)
        let newCount = 0;
        liveUsers.forEach(liveUser => {
            const exists = localUsers.some(u => u.email === liveUser.email);
            if (!exists) {
                localUsers.push(liveUser);
                newCount++;
            }
        });

        // 5. Save back to local JSON
        fs.writeFileSync(LOCAL_USERS_PATH, JSON.stringify(localUsers, null, 2), 'utf8');
        console.log(`💾 Local users.json updated! Added ${newCount} new users.`);
        console.log(`✨ Total local users: ${localUsers.length}`);

    } catch (error) {
        console.error('❌ Sync Failed:', error.response ? error.response.data : error.message);
    }
}

syncUsers();
