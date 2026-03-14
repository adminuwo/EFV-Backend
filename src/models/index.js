const mongoose = require('mongoose');

if (process.env.USE_JSON_DB === 'true') {
    module.exports = require('./jsonAdapter');
    return;
}

// Updated User Schema with professional dashboard features
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    phone: String,
    savedAddresses: [{
        fullName: String,
        phone: String,
        pincode: String,
        state: String,
        city: String,
        house: String,
        area: String,
        landmark: String,
        type: { type: String, default: 'Home' }, // Home, Work
        fullAddress: String, // Combined string for legacy support
        isDefault: { type: Boolean, default: false }
    }],
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    notifications: [{
        _id: { type: String }, // Allow custom string IDs to prevent BSONError
        title: String,
        message: String,
        type: { type: String, enum: ['Order', 'Payment', 'Digital', 'Shipment', 'General'], default: 'General' },
        link: String,
        isRead: { type: Boolean, default: false },
        createdAt: { type: Date, default: Date.now }
    }],
    paymentMethods: [{
        type: { type: String, default: 'card' },
        last4: String,
        brand: String
    }],
    resetPasswordOTP: String,
    resetPasswordExpires: Date,
    resetAttempts: { type: Number, default: 0 },
    googleId: String,
    avatar: String,
    createdAt: { type: Date, default: Date.now }
});

const productSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, default: "EFV Authorized Member" },
    type: { type: String, enum: ['EBOOK', 'AUDIOBOOK', 'PAPERBACK', 'HARDCOVER'], required: true },
    price: { type: Number, required: true },
    discountPrice: { type: Number }, // Actual selling price if discounted
    discount: { type: Number, default: 0 }, // Percentage or absolute discount
    stock: { type: Number, default: 0 },
    filePath: { type: String }, // Optional for physical books (PDF/Audio)
    thumbnail: String,
    gallery: [String], // Array of image paths
    category: { type: String, default: 'Digital' },
    description: String,
    volume: String, // e.g. "1", "2"
    language: { type: String, default: 'Hindi' }, // Hindi, English
    legacyId: { type: String, sparse: true, unique: true }, // For string IDs like "efv_v1_audiobook"

    // Shipping Details (for Shiprocket)
    weight: { type: Number, default: 0 }, // in grams
    length: { type: Number, default: 0 }, // in cm
    breadth: { type: Number, default: 0 }, // in cm
    height: { type: Number, default: 0 }, // in cm
    duration: String, // e.g. "12:35" for audiobooks

    // Chapter-Based Audiobook System
    totalChapters: { type: Number, default: 0 },
    chapters: [{
        chapterNumber: { type: Number, required: true },
        title: { type: String, default: '' },
        filePath: { type: String, default: '' }, // e.g. uploads/audios/chapter-1.mp3
        duration: { type: String, default: '' }, // e.g. "12:35"
        uploadedAt: { type: Date }
    }],

    createdAt: { type: Date, default: Date.now }
});

// New Cart Schema
const cartSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        quantity: { type: Number, default: 1 },
        addedAt: { type: Date, default: Date.now }
    }],
    updatedAt: { type: Date, default: Date.now }
});

// New Digital Library Schema
const digitalLibrarySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        title: String,
        type: { type: String }, // EBOOK or AUDIOBOOK
        thumbnail: String,
        filePath: String,
        purchasedAt: { type: Date, default: Date.now },
        progress: { type: Number, default: 0 }, // For reading/listening progress
        lastAccessed: { type: Date, default: Date.now },
        // Audiobook chapter-level resume
        lastChapter: { type: Number, default: 0 },
        lastChapterTime: { type: Number, default: 0 },
        orderId: String,
        accessStatus: { type: String, default: 'active' }
    }]
});

const purchaseSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    transactionId: String,
    purchaseDate: { type: Date, default: Date.now }
});

const orderItemSchema = new mongoose.Schema({
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    title: String,
    price: Number,
    quantity: Number,
    type: { type: String }
});

const orderSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Linked to User
    customer: {
        name: String,
        email: String,
        phone: String,
        address: Object, // Store the full address object for reliability
        city: String,
        zip: String
    },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    shippingCharges: { type: Number, default: 0 },
    codCharges: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    paymentMethod: { type: String, default: 'COD' },
    status: {
        type: String,
        enum: ['Pending', 'Processing', 'Packed', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Returned', 'Failed', 'Completed (Digital)'],
        default: 'Pending'
    },
    orderType: { type: String, enum: ['physical', 'digital'], default: 'physical' },
    paymentStatus: { type: String, default: 'Pending' },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    cashfreeOrderId: String,
    cashfreePaymentSessionId: String,
    invoicePath: String, // Path to generated PDF invoice
    shipmentId: String, // Shiprocket/Nimbus Shipment ID
    awbNumber: String,
    courierName: String,
    trackingLink: String,
    labelUrl: String,           // URL for the shipping label
    courierId: String,          // Nimbus courier internal ID
    couponCode: { type: String, default: '' },           // Coupon applied
    discountAmount: { type: Number, default: 0 },         // Discount applied
    partnerRef: {                                          // Partner tracking
        partnerId: String,
        partnerName: String,
        couponCode: String,
        commissionPercent: Number,
        commissionAmount: Number,
        commissionPaid: { type: Boolean, default: false }
    },
    timeline: [{
        status: String,
        timestamp: { type: Date, default: Date.now },
        note: String
    }],
    createdAt: { type: Date, default: Date.now }
});

const paymentSchema = new mongoose.Schema({
    orderId: { type: String, required: true },
    paymentId: String, // Razorpay Payment ID
    amount: { type: Number, required: true },
    method: String, // Card, UPI, etc.
    status: { type: String, enum: ['Paid', 'Failed', 'Pending', 'Refunded'], default: 'Pending' },
    razorpayData: Object, // Full response for auditing
    date: { type: Date, default: Date.now }
});

const shipmentSchema = new mongoose.Schema({
    orderId: { type: String, required: true, unique: true },
    shipmentId: String, // Courier/Shiprocket ID
    courierName: { type: String, default: '' },
    awbNumber: { type: String, default: '' },
    shippingStatus: { type: String, default: 'Pending' },
    trackingLink: String,
    labelUrl: String,
    createdAt: { type: Date, default: Date.now }
});

const couponSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    type: { type: String, enum: ['Percentage', 'Flat'], default: 'Percentage' },
    value: { type: Number, required: true },
    minOrder: { type: Number, default: 0 },
    expiryDate: Date,
    usageLimit: { type: Number, default: 100 },
    usedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // Partner Tracking
    isPartnerCoupon: { type: Boolean, default: false },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner' },
    partnerName: { type: String, default: '' },
    commissionPercent: { type: Number, default: 0 }, // % of order value as commission
    createdAt: { type: Date, default: Date.now }
});

const userProgressSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: ['EBOOK', 'AUDIOBOOK'], required: true },
    progress: { type: Number, default: 0 }, // 0-100 percentage

    // Audio Specific
    currentTime: { type: Number, default: 0 }, // Seconds
    totalDuration: { type: Number, default: 0 },

    // E-book Specific
    lastPage: { type: Number, default: 1 },
    totalPages: { type: Number, default: 0 },
    scrollPosition: { type: Number, default: 0 },

    lastUpdated: { type: Date, default: Date.now }
});

// Chapter-level audiobook progress
const audiobookProgressSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    // Per-chapter tracking
    chapters: [{
        chapterIndex: { type: Number, required: true }, // 0-based index
        currentTime: { type: Number, default: 0 },   // seconds
        duration: { type: Number, default: 0 },       // total seconds
        completed: { type: Boolean, default: false },
        lastUpdated: { type: Date, default: Date.now }
    }],
    // Current position
    currentChapterIndex: { type: Number, default: 0 },
    currentChapterTime: { type: Number, default: 0 },
    totalCompletedChapters: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
});

audiobookProgressSchema.index({ userId: 1, productId: 1 }, { unique: true });

const supportSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    email: String,
    subject: String,
    message: String,
    status: { type: String, enum: ['Open', 'In Progress', 'Resolved', 'Closed'], default: 'Open' },
    reply: String,
    repliedAt: Date,
    createdAt: { type: Date, default: Date.now }
});

userProgressSchema.index({ userId: 1, productId: 1 }, { unique: true });

// Partner Schema — tracks marketing partner companies/individuals
const partnerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, default: '' },
    company: { type: String, default: '' },
    password: { type: String, default: '' }, // Set during activation
    token: { type: String, default: '' }, // Invitation token/Unique ID
    partner_token: { type: String, default: '' }, // Generated marketing token
    status: { type: String, default: 'Active' }, // Active, Verified
    notes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    isActivated: { type: Boolean, default: false }, // Email verified & password set
    otp: { type: String, default: '' },
    otpExpires: { type: Date },
    totalCommissionEarned: { type: Number, default: 0 },
    totalCommissionPaid: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const partnerSaleSchema = new mongoose.Schema({
    partnerId: { type: String, required: true },
    orderId: { type: String, required: true },
    customerName: { type: String, required: true },
    customerEmail: { type: String, default: '' },
    productName: { type: String, default: '' },
    totalPrice: { type: Number, required: true },
    couponCode: { type: String, required: true },
    commissionPercent: { type: Number, default: 0 },
    commissionAmount: { type: Number, required: true },
    paymentStatus: { type: String, enum: ['Paid', 'Unpaid'], default: 'Unpaid' },
    payoutDate: { type: Date },
    adminNotes: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

const returnRequestSchema = new mongoose.Schema({
    orderId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        title: String,
        price: Number,
        quantity: Number
    }],
    reason: { type: String, required: true },
    imageProof: String, // Path to uploaded image
    status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Picked Up', 'Returned'], default: 'Pending' },
    adminNotes: String,
    reverseShipmentId: String,
    createdAt: { type: Date, default: Date.now }
});

const partnerMessageSchema = new mongoose.Schema({
    partnerId: { type: String, required: true },
    partnerName: String,
    partnerEmail: String,
    subject: String,
    message_text: { type: String, required: true },
    sender_type: { type: String, enum: ['admin', 'partner'], required: true },
    status: { type: String, enum: ['Open', 'Resolved'], default: 'Open' },
    isReadByAdmin: { type: Boolean, default: false },
    isReadByPartner: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const orderCancellationSchema = new mongoose.Schema({
    orderId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: String,
    cancelledAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

module.exports = {
    User: mongoose.model('User', userSchema),
    Product: mongoose.model('Product', productSchema),
    Purchase: mongoose.model('Purchase', purchaseSchema),
    Order: mongoose.model('Order', orderSchema),
    Cart: mongoose.model('Cart', cartSchema),
    DigitalLibrary: mongoose.model('DigitalLibrary', digitalLibrarySchema),
    UserProgress: mongoose.model('UserProgress', userProgressSchema),
    AudiobookProgress: mongoose.model('AudiobookProgress', audiobookProgressSchema),
    Payment: mongoose.model('Payment', paymentSchema),
    Shipment: mongoose.model('Shipment', shipmentSchema),
    Coupon: mongoose.model('Coupon', couponSchema),
    Support: mongoose.model('Support', supportSchema),
    Partner: mongoose.model('Partner', partnerSchema),
    PartnerSale: mongoose.model('PartnerSale', partnerSaleSchema),
    PartnerMessage: mongoose.model('PartnerMessage', partnerMessageSchema),
    ReturnRequest: mongoose.model('ReturnRequest', returnRequestSchema),
    OrderCancellation: mongoose.model('OrderCancellation', orderCancellationSchema)
};
