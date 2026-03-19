const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const adminAuth = require('../middleware/adminAuth');

// ─────────────────────────────────────────────────────────────────────────────
// ☁️ SMART STORAGE: GOOGLE CLOUD STORAGE
// Native fallback: Uploads to local disk first, then pushes to GCS cleanly
// ─────────────────────────────────────────────────────────────────────────────
const hasGCS = process.env.GCS_BUCKET_NAME && process.env.GCS_BUCKET_NAME !== 'efv-assets-bucket';
let useGCS = false;
let storageClient;

if (hasGCS) {
    console.log('☁️ [Upload] Using NATIVE GOOGLE CLOUD STORAGE (Disk -> Bucket Mode)');
    useGCS = true;
    const { Storage } = require('@google-cloud/storage');
    storageClient = new Storage({
        projectId: process.env.GCS_PROJECT_ID || 'efvframework'
    });
} else {
    console.log('📁 [Upload] Using LOCAL DISK storage (Fallback Mode)');
}

// ALWAYs save to disk first (prevents RAM crashes on large files)
const diskStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const rootDir = path.join(__dirname, '../../');
        let dest = path.join(rootDir, 'src/uploads/audios');
        if (file.fieldname === 'cover') dest = path.join(rootDir, 'src/uploads/covers');
        else if (file.fieldname === 'ebook') dest = path.join(rootDir, 'src/uploads/ebooks');
        else if (file.fieldname === 'gallery') dest = path.join(rootDir, 'src/uploads/gallery');

        try {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        } catch (e) {
            // Ignore if it already exists due to parallel form field parsing race conditions
            if (e.code !== 'EEXIST') console.error("Error creating directory:", e);
        }
        
        cb(null, dest);
    },
    filename: function (req, file, cb) {
        const safeName = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + '-' + safeName);
    }
});

const upload = multer({ storage: diskStorage, limits: { fileSize: 1000 * 1024 * 1024 } }); // 1GB limit

// Helper to manually upload local file to GCS
const uploadFileToGCS = async (localFilePath, originalname, fieldname) => {
    // Determine which bucket to use
    // If it's a cover or gallery (images), use the cover bucket if configured
    let bucketName = process.env.GCS_BUCKET_NAME;
    if ((fieldname === 'cover' || fieldname === 'gallery') && process.env.GCS_COVER_BUCKET_NAME) {
        bucketName = process.env.GCS_COVER_BUCKET_NAME;
    }
    
    const bucket = storageClient.bucket(bucketName);
    const safeName = originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    
    const folder = fieldname === 'cover' ? 'covers' : 
                   fieldname === 'ebook' ? 'ebooks' : 
                   fieldname === 'gallery' ? 'gallery' : 'audios';
                   
    const gcsFileName = `${folder}/${fieldname}-${uniqueSuffix}-${safeName}`;

    let contentType = 'application/octet-stream';
    if (fieldname === 'ebook') contentType = 'application/pdf';
    else if (fieldname.includes('audio') || fieldname.includes('chapter')) contentType = 'audio/mpeg';
    else if (fieldname === 'cover' || fieldname === 'gallery') contentType = 'image/jpeg';

    await bucket.upload(localFilePath, {
        destination: gcsFileName,
        metadata: { contentType: contentType },
        resumable: true // helps with large files like audiobooks
    });

    return `https://storage.googleapis.com/${bucketName}/${gcsFileName}`;
};

// Upload route
router.post('/', adminAuth, (req, res, next) => {
    res.setHeader('X-Upload-Version', '2.4'); // Version bumped for GCS Native Disk mode
    console.log(`🚀 [v2.4] Upload Request Started (Mode: ${useGCS ? 'GCS Native ☁️' : 'Local 📁'})`);

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
            const localName = file.filename;
            
            // Build local path string first
            let localRelativePath = '';
            if (file.fieldname === 'cover') localRelativePath = `uploads/covers/${localName}`;
            else if (file.fieldname === 'ebook') localRelativePath = `uploads/ebooks/${localName}`;
            else if (file.fieldname === 'audio') localRelativePath = `uploads/audios/${localName}`;
            else if (file.fieldname === 'gallery') localRelativePath = `uploads/gallery/${localName}`;
            else if (file.fieldname.startsWith('chapter_')) localRelativePath = `uploads/audios/${localName}`;

            if (useGCS) {
                // Upload this disk file to GCS
                console.log(`  - Uploading Disk -> GCS: ${file.fieldname} (${file.originalname})`);
                try {
                    storagePath = await uploadFileToGCS(file.path, file.originalname, file.fieldname);
                    console.log(`  ✔ GCS Upload Success: ${storagePath}`);
                    
                    // Optional: Delete local file after successful cloud upload to save space
                    // if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                } catch (gcsError) {
                    console.error(`  ❌ GCS Upload Failed for ${file.originalname}:`, gcsError.message);
                    console.log('  ⚠️ Falling back to local file for this item.');
                    storagePath = localRelativePath;
                }
            } else {
                console.log(`  - Saved Local Only: ${file.fieldname} -> ${localName}`);
                storagePath = localRelativePath;
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
            message: 'Files uploaded successfully',
            paths: responseIds,
            mode: useGCS ? 'gcs' : 'local'
        });
    } catch (error) {
        console.error('❌ Processing error:', error);
        res.status(500).json({ message: 'File processing failed', error: error.message });
    }
});

module.exports = router;
