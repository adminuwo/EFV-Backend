const jwt = require('./node_modules/jsonwebtoken');
const mongoose = require('./node_modules/mongoose');
const http = require('http');
require('./node_modules/dotenv').config({ path: './.env' });

async function test() {
    await mongoose.connect(process.env.MONGO_URI);
    const user = await mongoose.connection.db.collection('users').findOne({email: 'admin@uwo24.com'});
    
    const token = jwt.sign({id: user._id, email: user.email, role: user.role}, process.env.JWT_SECRET || 'secret123');
    
    console.log("Token generated.");
    
    const options = {
        hostname: 'localhost',
        port: 8080,
        path: '/api/library/my-library',
        method: 'GET',
        headers: {
            'Authorization': 'Bearer ' + token
        }
    };

    const req = http.request(options, res => {
        let body = '';
        res.on('data', d => { body += d; });
        res.on('end', () => {
            const data = JSON.parse(body);
            console.log("Library items count:", data.length);
            if (data.length > 0) {
                console.log("Sample item:");
                console.log(JSON.stringify(data[0], null, 2));
            }
            process.exit(0);
        });
    });

    req.on('error', error => {
        console.error(error);
        process.exit(1);
    });

    req.end();
}
test().catch(console.error);
