const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
console.log('__dirname:', __dirname);
console.log('PORT:', process.env.PORT);
console.log('USE_JSON_DB:', process.env.USE_JSON_DB);
console.log('CASHFREE_MODE:', process.env.CASHFREE_MODE);
console.log('CASHFREE_APP_ID:', process.env.CASHFREE_APP_ID);
