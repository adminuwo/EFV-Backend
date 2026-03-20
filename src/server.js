require("dotenv").config();

const express = require('express');
console.log("🚀 Server: Loading Version 1.3 (Active)... Port: 8080");
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const nimbusShipping = require("./routes/nimbusShipping").default || require("./routes/nimbusShipping");

// Load .env from parent directory (EFV-Backend/.env)
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('./config/db');

// Connect to Database
connectDB().then(() => {
    // Drop problematic index if it exists (legacyId uniqueness fix)
    if (process.env.USE_JSON_DB !== 'true') {
        const mongoose = require('mongoose');
        const dropIndex = async () => {
            try {
                const collections = await mongoose.connection.db.listCollections({ name: 'products' }).toArray();
                if (collections.length > 0) {
                    await mongoose.connection.db.collection('products').dropIndex('legacyId_1');
                    console.log('🗑️ Successfully dropped legacyId_1 unique index');
                }
            } catch (e) {
                // Index might not exist, ignore
            }
        };

        if (mongoose.connection.readyState === 1) {
            dropIndex();
        } else {
            mongoose.connection.on('open', dropIndex);
        }
    }
});

// Ensure upload directories exist on startup
const fs = require('fs');
const uploadDirs = [
    path.join(__dirname, 'uploads/covers'),
    path.join(__dirname, 'uploads/ebooks'),
    path.join(__dirname, 'uploads/gallery'),
    path.join(__dirname, 'uploads/audios')
];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
    }
});

const app = express();

console.log('--- DATABASE MODE CHECK ---');
console.log('USE_JSON_DB:', process.env.USE_JSON_DB);
console.log('---------------------------');

const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3000'
];

// Add FRONTEND_URL from env if present
const envFrontendUrl = process.env.FRONTEND_URL;
if (envFrontendUrl) {
    const formattedUrl = envFrontendUrl.startsWith('http') ? envFrontendUrl : `https://${envFrontendUrl}`;
    if (!allowedOrigins.includes(formattedUrl)) allowedOrigins.push(formattedUrl);
}

// Add common domain variants if needed
const commonDomain = process.env.EXTERNAL_DOMAIN || 'efvframework.com'; // Default to live domain
if (commonDomain) {
    const domains = commonDomain.split(',').map(d => d.trim());
    domains.forEach(d => {
        if (!allowedOrigins.includes(`https://${d}`)) allowedOrigins.push(`https://${d}`);
        if (!allowedOrigins.includes(`https://www.${d}`)) allowedOrigins.push(`https://www.${d}`);
    });
}

app.use((req, res, next) => {
    // Support Google Login popups by allowing cross-origin-opener-policy
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    
    const logStr = `[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin} - Referer: ${req.headers.referer} - Auth: ${req.headers.authorization ? 'Present' : 'Missing'}\n`;
    console.log(logStr);
    try {
        require('fs').appendFileSync(require('path').join(__dirname, 'data', 'requests.log'), logStr);
    } catch (e) {}
    next();
});

app.use(cors({
    origin: (origin, callback) => {
        // Allow all localhost origins during development
        if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1') || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn('Blocked by CORS:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Range'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
    credentials: true
}));
app.use(express.json());

// Serve Frontend Static Files
// Serve Frontend Static Files (Attempt sibling directory first, then local)
let frontendPath = path.join(__dirname, '..', '..', 'EFV-F', 'public');
if (!fs.existsSync(frontendPath)) {
    frontendPath = path.join(__dirname, '..', 'public');
}

// In-memory storage for demo mode (no MongoDB required)
global.demoUsers = new Map(); // email -> { name, email, library: [] }
global.demoProgress = new Map(); // userId+productId -> { progress, total, lastUpdated }
global.demoProducts = [
    {
        _id: 'efv_v1_audiobook',
        title: 'EFV™ VOL 1: The Origin Code (Audiobook)',
        type: 'AUDIOBOOK',
        price: 199,
        originalPrice: 999,
        image: 'img/vol1-cover.png',
        chapters: 5,
        rating: 4.9,
        reviews: 245
    },
    {
        _id: 'efv_v2_hardcover',
        title: 'EFV™ VOL 1: The Origin Code (Hardcover)',
        type: 'HARDCOVER',
        price: 799,
        originalPrice: 1499,
        image: 'img/v1-physical.png',
        stock: 50,
        rating: 4.8,
        reviews: 189
    }
];

// Health check routes
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is healthy', timestamp: new Date() });
});
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'API is healthy', timestamp: new Date() });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
const productRoutes = require('./routes/products');
app.use('/api/products', productRoutes);
app.use('/api/orders', require('./routes/orders'));
app.use('/api/users', require('./routes/users'));
app.use('/api/library', require('./routes/library'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/content', require('./routes/content'));
app.use('/api/coupons', require('./routes/coupons'));
app.use('/api/returns', require('./routes/returns'));
app.use('/api/support', require('./routes/support'));
app.use('/api/partners', require('./routes/partners'));
app.use('/api/partner-portal', require('./routes/partnerPortal'));
app.use('/api/partner-messages', require('./routes/partnerMessages'));
app.use('/api/audiobook-progress', require('./routes/audiobookProgress'));
app.use('/api/demo', require('./routes/demo'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/shipments', require('./routes/shipments'));
app.use('/api/nimbus', nimbusShipping);
app.use('/api/upload', require('./routes/upload'));
app.use('/api/images', require('./routes/images'));
app.use('/api/rag', require('./routes/rag'));
app.use('/api/chat', require('./routes/chat'));

// Initial Seed (if DB empty)
setTimeout(() => {
    if (typeof productRoutes.seedProducts === 'function') {
        productRoutes.seedProducts();
    }
}, 5000);

// Dynamic Frontend Configuration
// Serving /js/api-config.js dynamically to inject BACKEND_URL from environment variables
const serveDynConfig = (req, res) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
    
    // Auto-resolve API base URL from the request itself if BACKEND_URL is not set
    // This works perfectly whether on localhost, staging, or production.
    const finalUrl = process.env.BACKEND_URL || (req.get('host') ? `${req.protocol}://${req.get('host')}` : '');
    
    const jsContent = `
/**
 * EFV API Configuration (Dynamically Generated by Backend)
 */
const CONFIG = {
    API_BASE_URL: '${finalUrl}',
    GOOGLE_CLIENT_ID: '${googleClientId}',
    BASE_PATH: window.location.pathname.includes('/pages/') ? '../' : ''
};

console.log('🔗 EFV API connected to: ' + CONFIG.API_BASE_URL);
if (CONFIG.API_BASE_URL.includes('localhost')) {
    console.warn('⚠️ WARNING: Frontend is connecting to LOCALHOST API. If this is a live site, login will fail.');
}
    `;
    res.set('Content-Type', 'application/javascript');
    res.set('Cache-Control', 'no-store, max-age=0');
    res.send(jsContent);
};

app.get('/js/api-config.js', serveDynConfig);
app.get('/api/config.js', serveDynConfig);


// Static files (PDFs, Audio, Images)
app.use('/content', express.static(path.join(__dirname, 'data', 'content')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(frontendPath));


// Fallback for SPA
app.get('*', (req, res) => {
    // If request is for API, don't serve index.html
    if (req.url.startsWith('/api/')) {
        return res.status(404).json({ message: 'API Route not found' });
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Consolidated Nimbus Login using nimbusPostService
const nimbusPostService = require('./services/nimbusPostService');
nimbusPostService.login().then(() => {
    console.log("✅ Initial Nimbus Authentication Complete");
}).catch(err => {
    console.error("❌ Pre-emptive Nimbus Authentication Failed, will retry on use.");
});

const PORT = process.env.PORT || 8080;
// Removing '0.0.0.0' to let Node decide the best interface (usually binds all, which is required by Cloud Run)
const server = app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📁 Serving frontend from: ${frontendPath}`);
});

// INCREASE TIMEOUT for huge Audiobook Uploads!
// 30 mins = 1800000 ms (Defaults are usually fine, but big files need bigger limits)
server.timeout = 1800000;
server.keepAliveTimeout = 1800000;
server.headersTimeout = 1801000;
