/**
 * EFV Platform - JSON to MongoDB Migration Script
 * 
 * This script migrates all local JSON data to MongoDB.
 * It handles the fact that JSON IDs are custom strings (not ObjectIds).
 * 
 * Run with: node src/scripts/migrate_to_mongo.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const MONGO_URI = process.env.MONGO_URI;

// ─── Helper: read JSON file ───────────────────────────────────
function readJson(filename) {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    try { return JSON.parse(raw); } catch (e) { return []; }
}

// ─── Mongoose Schemas (minimal, flexible) ────────────────────

const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String,
    role: { type: String, default: 'user' },
    phone: String,
    savedAddresses: [mongoose.Schema.Types.Mixed],
    notifications: [mongoose.Schema.Types.Mixed],
    purchasedProducts: [String],
    googleId: String,
    avatar: String,
    legacyId: { type: String, index: true }, // original JSON _id
    createdAt: { type: Date, default: Date.now }
}, { strict: false });

const productSchema = new mongoose.Schema({
    title: String,
    subtitle: String,
    type: String,
    price: Number,
    discountPrice: Number,
    stock: Number,
    filePath: String,
    thumbnail: String,
    category: String,
    description: String,
    volume: String,
    language: String,
    author: String,
    weight: Number,
    length: Number,
    breadth: Number,
    height: Number,
    duration: String,
    totalChapters: Number,
    chapters: [mongoose.Schema.Types.Mixed],
    legacyId: { type: String, unique: true, index: true }, // original JSON _id like "efv_v1_hardcover"
    createdAt: { type: Date, default: Date.now }
}, { strict: false });

const orderSchema = new mongoose.Schema({
    orderId: { type: String, unique: true },
    userId: mongoose.Schema.Types.ObjectId,
    userLegacyId: String, // original JSON userId for reference
    customer: mongoose.Schema.Types.Mixed,
    items: [mongoose.Schema.Types.Mixed],
    totalAmount: Number,
    shippingCharges: Number,
    codCharges: Number,
    discountAmount: Number,
    paymentMethod: String,
    paymentStatus: String,
    status: String,
    orderType: String,
    timeline: [mongoose.Schema.Types.Mixed],
    shipmentId: mongoose.Schema.Types.Mixed,
    awbNumber: String,
    courierName: String,
    trackingLink: String,
    labelUrl: String,
    cashfreeOrderId: String,
    couponCode: String,
    partnerRef: mongoose.Schema.Types.Mixed,
    createdAt: { type: Date, default: Date.now }
}, { strict: false });

const digitalLibrarySchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    userLegacyId: String,
    items: [mongoose.Schema.Types.Mixed],
    updatedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
}, { strict: false });

const couponSchema = new mongoose.Schema({
    code: { type: String, unique: true },
    type: String,
    value: Number,
    minOrder: Number,
    expiryDate: Date,
    usageLimit: Number,
    usedCount: Number,
    isActive: Boolean,
    isPartnerCoupon: Boolean,
    partnerName: String,
    commissionPercent: Number,
    createdAt: { type: Date, default: Date.now }
}, { strict: false });

const partnerSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    phone: String,
    company: String,
    password: String,
    token: String,
    partner_token: String,
    status: String,
    isActive: Boolean,
    isActivated: Boolean,
    notes: String,
    totalCommissionEarned: Number,
    totalCommissionPaid: Number,
    createdAt: { type: Date, default: Date.now }
}, { strict: false });

const partnerMessageSchema = new mongoose.Schema({
    partnerId: String,
    partnerName: String,
    partnerEmail: String,
    subject: String,
    message_text: String,
    sender_type: String,
    status: String,
    isReadByAdmin: Boolean,
    isReadByPartner: Boolean,
    createdAt: { type: Date, default: Date.now }
}, { strict: false });

// ─── Main Migration ───────────────────────────────────────────
async function migrate() {
    console.log('\n🚀 EFV Migration: JSON → MongoDB');
    console.log('════════════════════════════════════');
    console.log(`🔗 Target DB: ${MONGO_URI}`);

    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const User = mongoose.model('User', userSchema);
    const Product = mongoose.model('Product', productSchema);
    const Order = mongoose.model('Order', orderSchema);
    const DigitalLibrary = mongoose.model('DigitalLibrary', digitalLibrarySchema);
    const Coupon = mongoose.model('Coupon', couponSchema);
    const Partner = mongoose.model('Partner', partnerSchema);
    const PartnerMessage = mongoose.model('PartnerMessage', partnerMessageSchema);

    const userLegacyMap = {}; // legacyId → MongoDB ObjectId
    const productLegacyMap = {}; // legacyId → MongoDB ObjectId

    // ── 1. PRODUCTS ──────────────────────────────────────────────
    console.log('📦 [1/7] Migrating Products...');
    const products = readJson('products.json');
    for (const p of products) {
        const legacyId = p._id || p.id || '';
        // Clean up $inc fields left by JSON adapter
        const cleanP = { ...p };
        delete cleanP.$inc;
        delete cleanP._id;
        delete cleanP.id;
        cleanP.legacyId = legacyId;

        try {
            const existing = await Product.findOne({ legacyId });
            if (existing) {
                productLegacyMap[legacyId] = existing._id;
                console.log(`  ↳ skip (exists): ${p.title} [${legacyId}]`);
            } else {
                const newP = await Product.create(cleanP);
                productLegacyMap[legacyId] = newP._id;
                console.log(`  ✔ created: ${p.title} [${legacyId}]`);
            }
        } catch (err) {
            console.error(`  ✘ Error on product ${legacyId}:`, err.message);
        }
    }

    // ── 2. USERS ─────────────────────────────────────────────────
    console.log('\n👤 [2/7] Migrating Users...');
    const users = readJson('users.json');
    for (const u of users) {
        const legacyId = u._id || u.id || '';
        const cleanU = { ...u };
        delete cleanU._id;
        delete cleanU.id;
        cleanU.legacyId = legacyId;

        // Map wishlist product IDs
        if (cleanU.wishlist) {
            cleanU.wishlist = cleanU.wishlist
                .map(pid => productLegacyMap[pid])
                .filter(Boolean);
        }

        try {
            const existing = await User.findOne({ email: u.email });
            if (existing) {
                userLegacyMap[legacyId] = existing._id;
                // Update legacyId if not set
                if (!existing.legacyId) {
                    await User.updateOne({ _id: existing._id }, { $set: { legacyId } });
                }
                console.log(`  ↳ skip (exists): ${u.email} [${legacyId}]`);
            } else {
                const newU = await User.create(cleanU);
                userLegacyMap[legacyId] = newU._id;
                console.log(`  ✔ created: ${u.email} [${legacyId}]`);
            }
        } catch (err) {
            console.error(`  ✘ Error on user ${u.email}:`, err.message);
        }
    }

    // ── 3. ORDERS ────────────────────────────────────────────────
    console.log('\n🧾 [3/7] Migrating Orders...');
    const orders = readJson('orders.json');
    for (const o of orders) {
        const cleanO = { ...o };
        const legacyUserId = o.userId || '';
        delete cleanO._id;
        delete cleanO.id;

        // Map userId
        cleanO.userLegacyId = legacyUserId;
        cleanO.userId = userLegacyMap[legacyUserId] || null;

        // Map product IDs in items — keep string productId for compatibility
        // (orders reference products by their original string IDs in most logic)

        try {
            const exists = await Order.findOne({ orderId: o.orderId });
            if (exists) {
                console.log(`  ↳ skip: ${o.orderId}`);
            } else {
                await Order.create(cleanO);
                console.log(`  ✔ created: ${o.orderId}`);
            }
        } catch (err) {
            console.error(`  ✘ Error on order ${o.orderId}:`, err.message);
        }
    }

    // ── 4. DIGITAL LIBRARY ───────────────────────────────────────
    console.log('\n📚 [4/7] Migrating Digital Library...');
    const library = readJson('digital_library.json');
    for (const lib of library) {
        const legacyUserId = lib.userId || '';
        const mongoUserId = userLegacyMap[legacyUserId];

        if (!mongoUserId && !legacyUserId) {
            console.log(`  ↻ skip: no user mapping for ${legacyUserId}`);
            continue;
        }

        const cleanLib = { ...lib };
        delete cleanLib._id;
        delete cleanLib.id;
        delete cleanLib._lastStatus;
        cleanLib.userLegacyId = legacyUserId;
        cleanLib.userId = mongoUserId || null;

        try {
            // Upsert by userLegacyId to avoid duplicates
            const existingLib = await DigitalLibrary.findOne({ userLegacyId: legacyUserId });
            if (existingLib) {
                // Merge items uniquely based on productId
                if (cleanLib.items && cleanLib.items.length > 0) {
                    const existingIds = (existingLib.items || []).map(i => i.productId);
                    const newItems = cleanLib.items.filter(i => !existingIds.includes(i.productId));
                    if (newItems.length > 0) {
                        await DigitalLibrary.updateOne(
                            { _id: existingLib._id },
                            { $push: { items: { $each: newItems } } }
                        );
                        console.log(`  ✔ updated library for: ${legacyUserId} (+${newItems.length} items)`);
                    } else {
                        console.log(`  ↳ skip library: ${legacyUserId} (no new items)`);
                    }
                }
            } else {
                await DigitalLibrary.create(cleanLib);
                console.log(`  ✔ created library for: ${legacyUserId}`);
            }
        } catch (err) {
            console.error(`  ✘ Error on library for ${legacyUserId}:`, err.message);
        }
    }

    // ── 5. COUPONS ───────────────────────────────────────────────
    console.log('\n🎟️  [5/7] Migrating Coupons...');
    const coupons = readJson('coupons.json');
    for (const c of coupons) {
        const cleanC = { ...c };
        delete cleanC._id;
        delete cleanC.id;
        try {
            const exists = await Coupon.findOne({ code: c.code });
            if (exists) { console.log(`  ↳ skip: ${c.code}`); continue; }
            await Coupon.create(cleanC);
            console.log(`  ✔ created: ${c.code}`);
        } catch (err) {
            console.error(`  ✘ Error on coupon ${c.code}:`, err.message);
        }
    }

    // ── 6. PARTNERS ──────────────────────────────────────────────
    console.log('\n🤝 [6/7] Migrating Partners...');
    const partners = readJson('partners.json');
    for (const p of partners) {
        const cleanP = { ...p };
        delete cleanP._id;
        delete cleanP.id;
        try {
            const exists = await Partner.findOne({ email: p.email });
            if (exists) { console.log(`  ↳ skip: ${p.email}`); continue; }
            await Partner.create(cleanP);
            console.log(`  ✔ created: ${p.email}`);
        } catch (err) {
            console.error(`  ✘ Error on partner ${p.email}:`, err.message);
        }
    }

    // ── 7. PARTNER MESSAGES ──────────────────────────────────────
    console.log('\n💬 [7/7] Migrating Partner Messages...');
    const messages = readJson('partner_messages.json');
    for (const m of messages) {
        const cleanM = { ...m };
        delete cleanM._id;
        delete cleanM.id;
        try {
            await PartnerMessage.create(cleanM);
            console.log(`  ✔ created message from: ${m.partnerEmail}`);
        } catch (err) {
            // ignore duplicate errors
        }
    }

    console.log('\n════════════════════════════════════');
    console.log('✅ Migration Complete!');
    console.log('\n📋 Summary:');
    console.log(`  Products migrated: ${Object.keys(productLegacyMap).length}`);
    console.log(`  Users migrated:    ${Object.keys(userLegacyMap).length}`);
    console.log('\n⚠️  INFO: The app routes use string IDs like "efv_v1_audiobook"');
    console.log('   These are stored in "legacyId" field in MongoDB.');
    console.log('   The content route uses these string IDs to look up files.');
    console.log('\n🔧 NEXT STEP: Check USE_JSON_DB=false in .env and restart the server.');
    process.exit(0);
}

migrate().catch(err => {
    console.error('\n❌ Migration Failed:', err);
    process.exit(1);
});
