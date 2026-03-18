const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const adminAuth = require('../middleware/adminAuth');

// ─────────────────────────────────────────────────────────────────────────────
// ☁️ SMART STORAGE: GOOGLE CLOUD STORAGE (NATIVE)
// Supports both Local (for dev) and GCS (for live) via Google Cloud Native SDK
// ─────────────────────────────────────────────────────────────────────────────
const hasGCS = process.env.GCS_BUCKET_NAME && process.env.GCS_BUCKET_NAME !== 'efv-assets-bucket';
let upload;
let useGCS = false;
let storageClient;

if (hasGCS) {
    console.log('☁️ [Upload] Using NATIVE GOOGLE CLOUD STORAGE (Bucket Mode)');
    useGCS = true;
    
    // Use the native SDK which fully supports CLI Application Default Credentials!
    const { Storage } = require('@google-cloud/storage');
    storageClient = new Storage({
        projectId: process.env.GCS_PROJECT_ID || 'ornate-charter-490605'
    });

    // When using GCS Native, we keep files in memory temporarily
    upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 500 * 1024 * 1024 }
    });

} else {
    // 📁 LOCAL FALLBACK
    console.log('📁 [Upload] Using LOCAL DISK storage (Fallback Mode)');
    const diskStorage = multer.diskStorage({
        destination: function (req, file, cb) {
            const rootDir = path.join(__dirname, '../../');
            let dest = path.join(rootDir, 'src/uploads/audios');
            if (file.fieldname === 'cover') dest = path.join(rootDir, 'src/uploads/covers');
            else if (file.fieldname === 'ebook') dest = path.join(rootDir, 'src/uploads/ebooks');
            else if (file.fieldname === 'gallery') dest = path.join(rootDir, 'src/uploads/gallery');

            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            cb(null, dest);
        },
        filename: function (req, file, cb) {
            const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, file.fieldname + '-' + uniqueSuffix + '-' + safeName);
        }
    });

    upload = multer({ storage: diskStorage, limits: { fileSize: 500 * 1024 * 1024 } });
}

// Helper to manually upload buffer to GCS
const uploadBufferToGCS = async (fileBuffer, originalname, fieldname) => {
    const bucket = storageClient.bucket(process.env.GCS_BUCKET_NAME);
    const safeName = originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    
    const folder = fieldname === 'cover' ? 'covers' : 
                   fieldname === 'ebook' ? 'ebooks' : 
                   fieldname === 'gallery' ? 'gallery' : 'audios';
                   
    const gcsFileName = `${folder}/${fieldname}-${uniqueSuffix}-${safeName}`;
    const file = bucket.file(gcsFileName);

    let contentType = 'application/octet-stream';
    if (fieldname === 'ebook') contentType = 'application/pdf';
    else if (fieldname.includes('audio') || fieldname.includes('chapter')) contentType = 'audio/mpeg';
    else if (fieldname === 'cover' || fieldname === 'gallery') contentType = 'image/jpeg';

    await file.save(fileBuffer, {
        metadata: { contentType: contentType },
        resumable: false
    });

    return `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${gcsFileName}`;
};

// Upload route
router.post('/', adminAuth, (req, res, next) => {
    res.setHeader('X-Upload-Version', '2.3'); // Version bumped for GCS Native
    console.log(`🚀 [v2.3] Upload Request Started (Mode: ${useGCS ? 'GCS Native ☁️' : 'Local 📁'})`);

    upload.any()(req, res, (err) => {
        if (err) {
            console.error('❌ Upload Error:', err);
            return res.status(400).json({ message: err.message || 'Upload error' });
        }
        next();
    });
}, async (req, res) => {
    try {
        const files = req.files || [];
        const responseIds = {};
        const chapterPaths = {};

        for (const file of files) {
            let storagePath = '';
            
            if (useGCS) {
                // Manually upload the memory buffer to GCS
                console.log(`  - Uploading to GCS: ${file.fieldname} (${file.originalname})`);
                storagePath = await uploadBufferToGCS(file.buffer, file.originalname, file.fieldname);
            } else {
                // Local disk uses the saved filename
                const localName = file.filename;
                console.log(`  - Saved Local: ${file.fieldname} -> ${localName}`);
                if (file.fieldname === 'cover') storagePath = `uploads/covers/${localName}`;
                else if (file.fieldname === 'ebook') storagePath = `uploads/ebooks/${localName}`;
                else if (file.fieldname === 'audio') storagePath = `uploads/audios/${localName}`;
                else if (file.fieldname === 'gallery') storagePath = `uploads/gallery/${localName}`;
                else if (file.fieldname.startsWith('chapter_')) storagePath = `uploads/audios/${localName}`;
            }

            if (file.fieldname === 'cover') responseIds.coverPath = storagePath;
            else if (file.fieldname === 'ebook') responseIds.ebookPath = storagePath;
            else if (file.fieldname === 'audio') responseIds.audioPath = storagePath;
            else if (file.fieldname === 'gallery') {
                if (!responseIds.galleryPaths) responseIds.galleryPaths = [];
                responseIds.galleryPaths.push(storagePath);
            } else if (file.fieldname.startsWith('chapter_')) {
                const index = file.fieldname.split('_')[1];
                chapterPaths[index] = storagePath;
            }
        }

        if (Object.keys(chapterPaths).length > 0) responseIds.chapterPaths = chapterPaths;

        console.log('✅ All files processed successfully!');
        res.json({
            message: 'Files uploaded successfully to ' + (useGCS ? 'Google Cloud' : 'Local'),
            paths: responseIds,
            mode: useGCS ? 'gcs' : 'local'
        });
    } catch (error) {
        console.error('❌ Processing error:', error);
        res.status(500).json({ message: 'File processing failed' });
    }
});

module.exports = router;
