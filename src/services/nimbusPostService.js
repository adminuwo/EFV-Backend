const axios = require('axios');
const NIMBUS_BASE_URL = 'https://api.nimbuspost.com/v1';

let cachedToken = null;

/**
 * Login to NimbusPost to get API Token
 */
async function login() {
    try {
        const response = await axios.post(`${NIMBUS_BASE_URL}/users/login`, {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });

        if (response.data.status && response.data.data) {
            cachedToken = response.data.data.trim();
            global.nimbusToken = cachedToken;
            return cachedToken;
        } else {
            throw new Error(response.data.message || 'NimbusPost Login Failed');
        }
    } catch (error) {
        console.error('❌ NimbusPost Login Error:', error.response?.data || error.message);
        throw error;
    }
}

const fs = require('fs');
const path = require('path');

async function logNimbus(message, data) {
    const logPath = path.join(__dirname, '..', 'data', 'nimbus_debug.log');
    const entry = `[${new Date().toISOString()}] ${message}: ${JSON.stringify(data, null, 2)}\n`;
    fs.appendFileSync(logPath, entry);
}

/**
 * Create a new shipment/order in NimbusPost
 */
async function createShipment(orderData) {
    if (!cachedToken) {
        await login();
    }

    try {
        console.log('📦 Creating Nimbus Shipment...', orderData.order_number);
        await logNimbus('REQUEST', orderData);

        const response = await axios.post(`${NIMBUS_BASE_URL}/shipments`, orderData, {
            headers: {
                'Authorization': `Bearer ${cachedToken}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('📄 Nimbus API Response Status:', response.data.status);
        await logNimbus('RESPONSE', response.data);

        // 🔄 HANDLE "No autoship rule found" - Retry with manual selection
        if (!response.data.status && response.data.message && response.data.message.includes('autoship rule')) {
            console.log('🔄 Nimbus: No autoship rule found. Selecting best courier manually...');

            try {
                const serviceResult = await checkServiceability({
                    origin: orderData.pickup.pincode || "482001",
                    destination: orderData.consignee.pincode,
                    payment_type: orderData.payment_type || "cod",
                    order_amount: orderData.order_amount || 100,
                    weight: Math.round(orderData.weight * 1000) // Grams
                });

                if (serviceResult.status && serviceResult.data && serviceResult.data.length > 0) {
                    const best = serviceResult.data[0];
                    console.log(`✅ Auto-selected courier: ${best.name} (ID: ${best.id})`);
                    return createShipment({ ...orderData, courier_id: best.id });
                }
            } catch (svcErr) {
                console.error('❌ Manual courier selection failed:', svcErr.message);
            }
        }

        if (!response.data.status) {
            console.warn('⚠️ Nimbus API Warning:', response.data.message);
        }
        return response.data;
    } catch (error) {
        const errorData = error.response?.data || error.message;
        console.error('❌ NimbusPost Error:', errorData);
        await logNimbus('ERROR', errorData);

        // Handle Token Expired (401)
        if (error.response?.status === 401 || (error.response?.data?.message?.toLowerCase().includes('token'))) {
            console.log('🔄 Nimbus Token Expired, retrying...');
            await login();
            return createShipment(orderData);
        }

        return error.response?.data || { status: false, message: error.message };
    }
}

/**
 * Get Tracking Data for an AWB
 */
async function trackShipment(awb) {
    if (!cachedToken) {
        await login();
    }

    try {
        const response = await axios.get(`${NIMBUS_BASE_URL}/shipments/track/${awb}`, {
            headers: {
                'Authorization': `Bearer ${cachedToken}`
            }
        });

        return response.data;
    } catch (error) {
        if (error.response?.status === 401) {
            await login();
            return trackShipment(awb);
        }
        console.error('❌ NimbusPost Tracking Error:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Get Serviceability for a pincode
 */
async function checkServiceability(data) {
    if (!cachedToken) {
        await login();
    }

    try {
        const response = await axios.post(`${NIMBUS_BASE_URL}/courier/serviceability`, data, {
            headers: {
                'Authorization': `Bearer ${cachedToken}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        if (error.response?.status === 401) {
            await login();
            return checkServiceability(data);
        }
        console.error('❌ Nimbus Serviceability Error:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = {
    login,
    trackShipment,
    createShipment,
    checkServiceability
};
