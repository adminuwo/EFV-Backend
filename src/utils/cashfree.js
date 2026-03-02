const { Cashfree, CFEnvironment } = require('cashfree-pg');

const getCashfreeInstance = () => {
    const cf = new Cashfree(
        process.env.CASHFREE_MODE === 'production' ? CFEnvironment.PRODUCTION : CFEnvironment.SANDBOX,
        process.env.CASHFREE_APP_ID,
        process.env.CASHFREE_SECRET_KEY
    );
    cf.XApiVersion = "2023-08-01";
    return cf;
};

const createCashfreeOrder = async (orderData) => {
    try {
        const cashfree = getCashfreeInstance();
        const request = {
            "order_amount": orderData.amount,
            "order_currency": "INR",
            "customer_details": {
                "customer_id": orderData.customerId,
                "customer_phone": orderData.customerPhone,
                "customer_email": orderData.customerEmail,
                "customer_name": orderData.customerName
            },
            "order_meta": {
                "return_url": orderData.returnUrl || `${process.env.FRONTEND_URL}/payment-status.html?order_id={order_id}`,
                "notify_url": orderData.notifyUrl || `${process.env.BACKEND_URL}/api/orders/cashfree-notify`
            }
        };

        const response = await cashfree.PGCreateOrder(request);
        return response.data;
    } catch (error) {
        console.error('Cashfree Order Creation Error:', error.response ? error.response.data : error.message);
        throw error;
    }
};

const verifyCashfreePayment = async (cfOrderId) => {
    try {
        const cashfree = getCashfreeInstance();
        const response = await cashfree.PGOrderFetchPayments(cfOrderId);
        return response.data;
    } catch (error) {
        console.error('Cashfree Verification Error:', error.response ? error.response.data : error.message);
        throw error;
    }
};

module.exports = {
    createCashfreeOrder,
    verifyCashfreePayment
};
