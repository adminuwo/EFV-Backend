const mongoose = require('mongoose');

const notificationLogSchema = new mongoose.Schema({
    orderId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['WhatsApp', 'Email', 'SMS'], default: 'WhatsApp' },
    status: { type: String, required: true }, // e.g. 'Order Placed', 'Shipped'
    recipient: { type: String, required: true }, // Phone number or Email
    message: String,
    deliveryStatus: { type: String, enum: ['sent', 'failed', 'delivered'], default: 'sent' },
    errorMessage: String,
    metadata: Object, // To store provider-specific IDs or responses
    sentAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
