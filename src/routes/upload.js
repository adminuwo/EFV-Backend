const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const adminAuth = require('../middleware/adminAuth');

const fs = require('fs');

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const rootDir = path.join(__dirname, '../../');
        let dest = path.join(rootDir, 'src/uploads/audios'); // Default to audios

        if (file.fieldname === 'cover') {
            dest = path.join(rootDir, 'src/uploads/covers');
        } else if (file.fieldname === 'ebook') {
            dest = path.join(rootDir, 'src/uploads/ebooks');
        } else if (file.fieldname === 'gallery') {
            dest = path.join(rootDir, 'src/uploads/gallery');
        }

        // Ensure directory exists
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        cb(null, dest);
    },
    filename: function (req, file, cb) {
        const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '-' + safeName);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        cb(null, true); // ALLOW ALL for debugging
    }
});

// Generate dynamic chapter fields for multer (up to 100 chapters)
const chapterFields = [];
for (let i = 0; i < 100; i++) {
    chapterFields.push({ name: `chapter_${i}`, maxCount: 1 });
}

// Upload route - handles everything dynamically
router.post('/', adminAuth, (req, res, next) => {
    res.setHeader('X-Upload-Version', '2.1'); // For verifying server restart
    console.log('🚀 [v2.1] Upload Request Started');
    upload.any()(req, res, (err) => {
        if (err) {
            console.error('❌ Multer Error:', err);
            return res.status(400).json({
                message: err.code === 'LIMIT_UNEXPECTED_FIELD' ? `Unexpected field: ${err.field}` : (err.message || 'Upload error'),
                code: err.code
            });
        }
        next();
    });
}, (req, res) => {
    try {
        console.log('📦 Files received:', req.files ? req.files.length : 0);
        const files = req.files || [];
        const responseIds = {};
        const chapterPaths = {};

        files.forEach(file => {
            console.log(`  - Processing field: ${file.fieldname} -> ${file.filename}`);
            if (file.fieldname === 'cover') {
                responseIds.coverPath = `uploads/covers/${file.filename}`;
            } else if (file.fieldname === 'ebook') {
                responseIds.ebookPath = `uploads/ebooks/${file.filename}`;
            } else if (file.fieldname === 'audio') {
                responseIds.audioPath = `uploads/audios/${file.filename}`;
            } else if (file.fieldname === 'gallery') {
                if (!responseIds.galleryPaths) responseIds.galleryPaths = [];
                responseIds.galleryPaths.push(`uploads/gallery/${file.filename}`);
            } else if (file.fieldname.startsWith('chapter_')) {
                const index = file.fieldname.split('_')[1];
                chapterPaths[index] = `uploads/audios/${file.filename}`;
            }
        });

        if (Object.keys(chapterPaths).length > 0) {
            responseIds.chapterPaths = chapterPaths;
        }

        console.log('✅ File Upload Success Mapping:', responseIds);

        res.json({
            message: 'Files uploaded successfully',
            paths: responseIds,
            version: '2.1'
        });
    } catch (error) {
        console.error('❌ Route handling error:', error);
        res.status(500).json({ message: 'File upload processing failed' });
    }
});

module.exports = router;
