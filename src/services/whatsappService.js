const axios = require('axios');
const { NotificationLog } = require('../models');
const nodemailer = require('nodemailer');

const WHATSAPP_API_VERSION = 'v21.0';
const WHATSAPP_BASE_URL = `https://graph.facebook.com/${WHATSAPP_API_VERSION}`;

/**
 * WhatsApp Notification Service
 */
class WhatsAppService {
    constructor() {
        this.token = process.env.WHATSAPP_TOKEN;
        this.phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        this.isEnabled = !!(this.token && this.phoneId);
        
        // Email fallback transporter
        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    /**
     * Send WhatsApp Message (Template based for business)
     */
    async sendMessage(to, templateName, components, orderId, userId) {
        if (!to) return { success: false, message: 'No recipient phone number' };
        
        // Format phone: ensuring it has country code (India default +91 if 10 digits)
        let formattedTo = String(to).replace(/\D/g, '');
        if (formattedTo.length === 10) formattedTo = '91' + formattedTo;

        if (!this.isEnabled) {
            console.log('⚠️ WhatsApp service not configured. Falling back to Email log.');
            return await this.fallbackLog(orderId, userId, formattedTo, templateName, components);
        }

        const url = `${WHATSAPP_BASE_URL}/${this.phoneId}/messages`;

        const payload = {
            messaging_product: "whatsapp",
            to: formattedTo,
            type: "template",
            template: {
                name: templateName,
                language: { code: "en" },
                components: components
            }
        };

        try {
            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json'
                }
            });

            // Log Success
            await NotificationLog.create({
                orderId,
                userId,
                recipient: formattedTo,
                status: templateName,
                deliveryStatus: 'sent',
                metadata: response.data
            });

            return { success: true, data: response.data };

        } catch (error) {
            const errorData = error.response?.data || error.message;
            console.error('❌ WhatsApp Send Error:', errorData);

            // Log Failure
            await NotificationLog.create({
                orderId,
                userId,
                recipient: formattedTo,
                status: templateName,
                deliveryStatus: 'failed',
                errorMessage: typeof errorData === 'object' ? JSON.stringify(errorData) : errorData
            });

            // FALLBACK: Send Email
            await this.sendFallbackEmail(orderId, userId, templateName);

            return { success: false, error: errorData };
        }
    }

    /**
     * Send Order Confirmation (Placed)
     */
    async sendOrderPlaced(order) {
        const customerName = order.customer?.name || 'Customer';
        const orderId = order.orderId;
        const totalAmount = `₹${order.totalAmount}`;
        const items = order.items.map(i => `${i.title} (x${i.quantity})`).join(', ').substring(0, 100);
        const trackLink = `https://efvframework.com/pages/tracking.html?id=${orderId}`;

        // Template components for 'order_placed'
        // Header: None or Image
        // Body params: [CustomerName, OrderID, TotalAmount, ItemList]
        // Buttons: [TrackLink]
        const components = [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: orderId },
                    { type: "text", text: totalAmount },
                    { type: "text", text: items }
                ]
            },
            {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [{ type: "text", text: orderId }]
            }
        ];

        return await this.sendMessage(order.customer.phone, "order_placed_v1", components, orderId, order.userId);
    }

    /**
     * Send Shipping Update
     */
    async sendOrderShipped(order) {
        const customerName = order.customer?.name || 'Customer';
        const orderId = order.orderId;
        const courier = order.courierName || 'Courier Partner';
        const awb = order.awbNumber || '';

        const components = [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: orderId },
                    { type: "text", text: courier },
                    { type: "text", text: awb }
                ]
            },
            {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [{ type: "text", text: orderId }]
            }
        ];

        return await this.sendMessage(order.customer.phone, "order_shipped_v1", components, orderId, order.userId);
    }

    /**
     * Send Delivery Confirmation
     */
    async sendOrderDelivered(order) {
        const customerName = order.customer?.name || 'Customer';
        const orderId = order.orderId;

        const components = [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: orderId }
                ]
            }
        ];

        return await this.sendMessage(order.customer.phone, "order_delivered_v1", components, orderId, order.userId);
    }

    /**
     * Send Cancellation Notice
     */
    async sendOrderCancelled(order, reason = 'Cancelled by user') {
        const customerName = order.customer?.name || 'Customer';
        const orderId = order.orderId;

        const components = [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: orderId },
                    { type: "text", text: reason }
                ]
            }
        ];

        return await this.sendMessage(order.customer.phone, "order_cancelled_v1", components, orderId, order.userId);
    }

    /**
     * Fallback Logger (No API keys provided)
     */
    async fallbackLog(orderId, userId, to, status, components) {
        await NotificationLog.create({
            orderId,
            userId,
            recipient: to,
            status: status,
            deliveryStatus: 'sent',
            message: `FALLBACK: WhatsApp message simulated for ${status}. Content params: ${JSON.stringify(components)}`
        });
        return { success: true, message: 'Logged as fallback' };
    }

    /**
     * Email Fallback (On API failure)
     */
    async sendFallbackEmail(orderId, userId, type) {
        try {
            const userEmail = await this.getUserEmail(userId);
            if (!userEmail) return;

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: userEmail,
                subject: `Update on your Order ${orderId}`,
                text: `Hi, your order status has been updated to ${type}. Please check our website for details.`
            };

            await this.transporter.sendMail(mailOptions);
            console.log(`📧 Fallback email sent to ${userEmail}`);
        } catch (e) {
            console.error('Email fallback failed:', e.message);
        }
    }

    async getUserEmail(userId) {
        if (!userId) return null;
        try {
            const { User } = require('../models');
            const user = await User.findById(userId);
            return user?.email;
        } catch (e) { return null; }
    }
}

module.exports = new WhatsAppService();
