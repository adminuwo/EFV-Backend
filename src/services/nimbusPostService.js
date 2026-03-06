const axios = require('axios');
const NIMBUS_BASE_URL = 'https://api.nimbuspost.com/v1';

let cachedToken = null;

/**
 * Login to NimbusPost to get API Token
 */
async function login() {
    try {
        console.log('🔑 Logging into NimbusPost...');
        const response = await axios.post(`${NIMBUS_BASE_URL}/users/login`, {
            email: process.env.NIMBUS_EMAIL,
            password: process.env.NIMBUS_PASSWORD
        });

        if (response.data.status && response.data.data) {
            cachedToken = response.data.data.trim();
            global.nimbusToken = cachedToken;
            console.log('✅ NimbusPost Token Secured');
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
    try {
        const logDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, 'nimbus_debug.log');
        const entry = `[${new Date().toISOString()}] ${message}: ${JSON.stringify(data, null, 2)}\n`;
        fs.appendFileSync(logPath, entry);
    } catch (err) {
        console.error('Logging failed:', err.message);
    }
}

/**
 * Get Serviceability / Best Courier
 */
async function getBestCourier(pincode, weight, paymentType, amount) {
    if (!cachedToken) await login();

    try {
        const payload = {
            origin: "482008", // Warehouse Pincode
            destination: pincode,
            payment_type: paymentType || "cod",
            order_amount: amount || 100,
            weight: Math.round(weight) // in grams
        };

        const response = await axios.post(`${NIMBUS_BASE_URL}/courier/serviceability`, payload, {
            headers: { 'Authorization': `Bearer ${cachedToken}` }
        });

        if (response.data.status && response.data.data && response.data.data.length > 0) {
            // Sort by cost or rating. We'll pick the first one which is usually recommended.
            return response.data.data[0];
        }
        return null;
    } catch (error) {
        console.error('❌ Serviceability Check Failed:', error.response?.data || error.message);
        return null;
    }
}

/**
 * Create a new shipment/order in NimbusPost
 */
async function createShipment(orderData) {
    if (!cachedToken) await login();

    try {
        console.log(`📦 Creating Nimbus Shipment for Order ${orderData.order_number}...`);
        await logNimbus('SHIPMENT_REQUEST', orderData);

        const response = await axios.post(`${NIMBUS_BASE_URL}/shipments`, orderData, {
            headers: {
                'Authorization': `Bearer ${cachedToken}`,
                'Content-Type': 'application/json'
            }
        });

        await logNimbus('SHIPMENT_RESPONSE', response.data);

        if (!response.data.status) {
            console.warn('⚠️ Nimbus API Warning:', response.data.message);
        }
        return response.data;
    } catch (error) {
        const errorData = error.response?.data || error.message;
        console.error('❌ NimbusPost Create Shipment Error:', errorData);
        await logNimbus('SHIPMENT_ERROR', errorData);

        if (error.response?.status === 401 || (error.response?.data?.message?.toLowerCase().includes('token'))) {
            cachedToken = null;
            await login();
            return createShipment(orderData);
        }

        return { status: false, message: error.response?.data?.message || error.message };
    }
}

/**
 * Generate Shipping Label
 */
async function generateLabel(awb) {
    if (!cachedToken) await login();
    try {
        const response = await axios.get(`${NIMBUS_BASE_URL}/shipments/label/${awb}`, {
            headers: { 'Authorization': `Bearer ${cachedToken}` }
        });
        return response.data;
    } catch (error) {
        console.error('❌ Label Gen Error:', error.response?.data || error.message);
        return { status: false, message: error.message };
    }
}

/**
 * Generate Manifest
 */
async function generateManifest(awb) {
    if (!cachedToken) await login();
    try {
        const response = await axios.post(`${NIMBUS_BASE_URL}/shipments/manifest`, { awb }, {
            headers: { 'Authorization': `Bearer ${cachedToken}` }
        });
        return response.data;
    } catch (error) {
        console.error('❌ Manifest Gen Error:', error.response?.data || error.message);
        return { status: false, message: error.message };
    }
}

/**
 * FULL AUTOMATION: Best Courier -> Create -> Label -> Manifest
 */
async function automateShipping(newOrder, address, physicalItems, paymentMethod) {
    try {
        const weight = physicalItems.reduce((sum, i) => sum + (i.weight || 500) * i.quantity, 0);
        const paymentType = paymentMethod.toLowerCase() === 'cod' ? 'cod' : 'prepaid';

        // 1. Get Best Courier
        const bestCourier = await getBestCourier(address.pincode, weight, paymentType, newOrder.totalAmount);
        const courierId = bestCourier ? bestCourier.id : null;

        if (bestCourier) {
            console.log(`✅ Selected Best Courier: ${bestCourier.name} (Cost: ₹${bestCourier.total_charges})`);
        }

        // 2. Prepare Payload
        const addressLine = [
            address.house, address.street, address.area, address.landmark, address.fullAddress,
            address.city, address.state, address.pincode
        ].filter(item => item && item.toString().trim().length > 0).join(', ') || 'Address not provided';

        const nimbusPayload = {
            order_number: newOrder.orderId,
            consignee: {
                name: address.fullName || address.name || 'Customer',
                email: address.email,
                phone: address.phone || '0000000000',
                address: addressLine,
                city: address.city || 'Unknown',
                state: address.state || 'Madhya Pradesh',
                pincode: address.pincode || address.zip || '000000',
                country: 'India'
            },
            pickup: {
                warehouse_name: "Office",
                name: "Gurumukh P Ahuja",
                contact_name: "Gurumukh P Ahuja",
                phone: "8871190020",
                address: "4th floor, SG Square Building, near PNB Bank",
                city: "Jabalpur",
                state: "Madhya Pradesh",
                pincode: "482008"
            },
            order_items: physicalItems.map(i => ({
                name: (i.title || 'Product').replace(/[^\x00-\x7F]/g, ""),
                qty: Number(i.quantity),
                price: Number(i.price),
                sku: (i.title || 'SKU').replace(/[^\x00-\x7F]/g, "").substring(0, 20)
            })),
            payment_type: paymentType,
            order_amount: Number(newOrder.totalAmount),
            order_total: Number(newOrder.totalAmount),
            weight: Number(weight),
            length: 15, breadth: 15, height: 5,
            shipment_type: 'regular',
            courier_id: courierId // Passing pre-selected courier ID
        };

        // 3. Create Shipment
        const nimbusResult = await createShipment(nimbusPayload);
        if (!nimbusResult.status) {
            return { status: false, message: nimbusResult.message };
        }

        const shipInfo = nimbusResult.data || {};
        const awb = shipInfo.awb_number || (typeof nimbusResult.data === 'string' ? nimbusResult.data : '');

        if (!awb) return { status: false, message: "AWB Number not generated" };

        // 4. Update Result Details
        const finalResult = {
            status: true,
            shipmentId: shipInfo.shipment_id || '',
            awbNumber: awb,
            courierName: bestCourier ? bestCourier.name : 'NimbusPost',
            labelUrl: shipInfo.label || '',
            trackingLink: shipInfo.tracking_url || `https://nimbuspost.com/track/${awb}`
        };

        // 5. If label not in response, try to fetch it
        if (!finalResult.labelUrl) {
            const labelData = await generateLabel(awb);
            if (labelData.status && labelData.data) {
                finalResult.labelUrl = labelData.data;
            }
        }

        // 6. Generate Manifest
        console.log(`📑 Generating Manifest for AWB: ${awb}...`);
        await generateManifest(awb);

        return finalResult;

    } catch (error) {
        console.error('❌ automateShipping Exception:', error);
        return { status: false, message: error.message };
    }
}

/**
 * Get Tracking Data for an AWB
 */
async function trackShipment(awb) {
    if (!cachedToken) await login();

    try {
        const response = await axios.get(`${NIMBUS_BASE_URL}/shipments/track/${awb}`, {
            headers: { 'Authorization': `Bearer ${cachedToken}` }
        });
        return response.data;
    } catch (error) {
        if (error.response?.status === 401) {
            cachedToken = null;
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
    if (!cachedToken) await login();

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
            cachedToken = null;
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
    checkServiceability,
    getBestCourier,
    generateLabel,
    generateManifest,
    automateShipping
};
