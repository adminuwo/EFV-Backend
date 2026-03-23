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
     * Send Abandoned Cart Recovery Message
     * @param {object} user 
     * @param {object} cart 
     * @param {number} reminderNo 1 or 2
     */
    async sendAbandonedCartRecovery(user, cart, reminderNo) {
        const customerName = user.name || 'Friend';
        const productsCount = cart.items.length;
        // Get the first product title for the message
        const firstProduct = cart.items[0]?.productId?.title || 'items in your cart';
        const productsDesc = productsCount > 1 ? `${firstProduct} and ${productsCount - 1} other item(s)` : firstProduct;
        
        // Direct Link to Cart
        const cartLink = `https://efvframework.com/pages/cart.html`; // Should open user's cart page instantly

        // Template components for 'cart_recovery'
        // Body params: [CustomerName, ProductListDescription]
        // Buttons: [CartLink]
        const components = [
            {
                type: "body",
                parameters: [
                    { type: "text", text: customerName },
                    { type: "text", text: productsDesc }
                ]
            },
            {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [{ type: "text", text: "cart.html" }] // Or just empty if base URL is cart
            }
        ];

        const templateName = reminderNo === 1 ? "cart_reminder_v1" : "cart_urgency_v2";
        
        return await this.sendMessage(user.phone || '', templateName, components, `cart-${cart._id}`, user._id);
    }

    /**
     * Process job from Worker
     */
    async processJob(job) {
        try {
            const { Order, User, Cart } = require('../models');

            if (job.type === 'OrderPlaced') {
                const orderIdStr = job.data.orderId;
                const order = await Order.findOne({ orderId: orderIdStr }) || await Order.findById(orderIdStr);
                if (!order) return false;
                const result = await this.sendOrderPlaced(order);
                return result.success;
            }

            if (job.type === 'AbandonedCart') {
                const user = await User.findById(job.userId);
                const cart = await Cart.findOne({ userId: job.userId }).populate('items.productId');
                
                if (!user || !cart || cart.items.length === 0 || cart.isPurchased) {
                    console.log(`⏩ Skipping abandoned cart job: user=${!!user}, cartItems=${cart?.items?.length}, purchased=${cart?.isPurchased}`);
                    return true; // Mark as completed (don't retry)
                }

                const result = await this.sendAbandonedCartRecovery(user, cart, job.data.reminderNo);
                return result.success;
            }

            return true;
        } catch (error) {
            console.error('Job Process Error in WhatsAppService:', error);
            return false;
        }
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
