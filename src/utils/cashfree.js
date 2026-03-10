const { Cashfree, CFEnvironment } = require('cashfree-pg');
const fs = require('fs');
const path = require('path');

// Initialize Cashfree Instance once
const cashfree = new Cashfree();
cashfree.XClientId = (process.env.CASHFREE_APP_ID || '').trim();
cashfree.XClientSecret = (process.env.CASHFREE_SECRET_KEY || '').trim();
cashfree.XEnvironment = process.env.CASHFREE_MODE === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX;

const getCashfreeInstance = () => {
    return cashfree;
};

const createCashfreeOrder = async (orderData) => {
    try {
        const cashfree = getCashfreeInstance();

        console.log(`--- Creating Cashfree Order ---`);
        console.log(`Mode: ${process.env.CASHFREE_MODE}`);
        console.log(`App ID: ${process.env.CASHFREE_APP_ID}`);
        console.log(`Customer ID: ${orderData.customerId}`);
        console.log(`Amount: ${orderData.amount}`);

        // Ensure phone is at least 10 digits and not all zeros
        const phone = (orderData.customerPhone && orderData.customerPhone.length >= 10)
            ? orderData.customerPhone
            : '9999999999';

        let returnUrl = orderData.returnUrl || `${process.env.FRONTEND_URL}/payment-status.html?order_id={order_id}`;
        let notifyUrl = orderData.notifyUrl || `${process.env.BACKEND_URL}/api/orders/cashfree-notify`;

        // 🔥 CRITICAL: Cashfree Production Mode strictly requires HTTPS return_url and notify_url
        if (process.env.CASHFREE_MODE === 'production') {
            if (returnUrl.startsWith('http://')) {
                console.log('⚠️ Upgrading return_url to HTTPS for Cashfree production requirements');
                returnUrl = returnUrl.replace('http://', 'https://');
            }
            if (notifyUrl.startsWith('http://')) {
                notifyUrl = notifyUrl.replace('http://', 'https://');
            }
        }

        const request = {
            "order_id": orderData.orderId,
            "order_amount": Number(orderData.amount),
            "order_currency": "INR",
            "customer_details": {
                "customer_id": orderData.customerId,
                "customer_phone": phone,
                "customer_email": orderData.customerEmail,
                "customer_name": orderData.customerName || 'Customer'
            },
            "order_meta": {
                "return_url": returnUrl,
                "notify_url": notifyUrl
            }
        };

        const response = await cashfree.PGCreateOrder(request);
        console.log(`✅ Cashfree Order Created: ${response.data.cf_order_id}`);
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error('Cashfree Order Creation Error:', JSON.stringify(errorData, null, 2));

        // Log to a file for persistent debugging
        const logPath = path.join(__dirname, '..', 'data', 'cashfree_error.log');
        const logEntry = `[${new Date().toISOString()}] Error: ${JSON.stringify(errorData)}\n`;
        fs.appendFileSync(logPath, logEntry);

        throw error;
    }
};

const verifyCashfreePayment = async (cfOrderId) => {
    try {
        const cashfree = getCashfreeInstance();
        // SDK v3+ Instance methods handle XApiVersion internally from the property
        const response = await cashfree.PGOrderFetchPayments(cfOrderId);
        return response.data;
    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error('Cashfree Verification Error:', JSON.stringify(errorData, null, 2));
        throw error;
    }
};

module.exports = {
    createCashfreeOrder,
    verifyCashfreePayment
};
