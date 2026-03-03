require("dotenv").config();

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const generateNimbusToken = require("./routes/nimbusToken");
const nimbusShipping = require("./routes/nimbusShipping").default || require("./routes/nimbusShipping");

// Load .env from parent directory (EFV-Backend/.env)
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('./config/db');

// Connect to Database
connectDB();

const app = express();

console.log('--- DATABASE MODE CHECK ---');
console.log('USE_JSON_DB:', process.env.USE_JSON_DB);
console.log('---------------------------');

app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve Frontend Static Files
const frontendPath = path.join(__dirname, '..', '..', 'EFV-F', 'public');

// In-memory storage for demo mode (no MongoDB required)
global.demoUsers = new Map(); // email -> { name, email, library: [] }
global.demoProgress = new Map(); // userId+productId -> { progress, total, lastUpdated }
global.demoProducts = [
    {
        _id: 'efv_v1_audiobook',
        title: 'EFV™ VOL 1: The Origin Code (Audiobook)',
        type: 'AUDIOBOOK',
        price: 199,
        filePath: 'audiobooks/efv-audio.mp3'
    },
    {
        _id: 'efv_v1_ebook',
        title: 'EFV™ VOL 1: The Origin Code (E-Book)',
        type: 'EBOOK',
        price: 149,
        filePath: 'ebooks/efv-checklist.pdf'
    }
];

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/library', require('./routes/library'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/demo', require('./routes/demo'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/users', require('./routes/users'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/shipments', require('./routes/shipments'));
app.use('/api/coupons', require('./routes/coupons'));
app.use('/api/partners', require('./routes/partners'));
app.use('/api/partner-portal', require('./routes/partnerPortal'));
app.use('/api/support', require('./routes/support'));
app.use('/api/audiobook-progress', require('./routes/audiobookProgress'));
app.use("/api/nimbus", nimbusShipping);
app.use(express.static(frontendPath));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Fallback to index.html for any other routes (to support SPA if needed)
app.use('/api', (req, res, next) => next());

app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err);
    res.status(err.status || 500).json({
        message: err.message || 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

// Nimbus token generate at server start
generateNimbusToken();

// auto refresh token every 12 hours
setInterval(generateNimbusToken, 1000 * 60 * 60 * 12);

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📁 Serving frontend from: ${frontendPath}`);
});
