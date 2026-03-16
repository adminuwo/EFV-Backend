const mongoose = require('mongoose');

const connectDB = async () => {
    if (process.env.USE_JSON_DB === 'true') {
        console.log('ℹ️ Running in Local JSON Database Mode (No MongoDB required)');
        return;
    }
    try {
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ Error connecting to MongoDB: ${error.message}`);
        // In Cloud Run/Production, we might want to log the error but NOT exit the process
        // so that the server can still start and listen on its assigned port.
        // This prevents the "Container failed to start and listen" error if DB is temporarily down.
        // process.exit(1); 
    }
};

module.exports = connectDB;
