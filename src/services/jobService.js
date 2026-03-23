const { NotificationJob } = require('../models');

/**
 * Job Service for delayed WhatsApp notifications
 * Used for: 
 * 1. Order Confirmation (2-3 min delay)
 * 2. Abandoned Cart (24h/48h delay logic is in worker)
 */
const jobService = {
    /**
     * Schedule a notification
     * @param {string} userId 
     * @param {string} type 'OrderPlaced' | 'AbandonedCart'
     * @param {number} delayMinutes 
     * @param {object} data 
     */
    async schedule(userId, type, delayMinutes, data) {
        try {
            const scheduledFor = new Date();
            scheduledFor.setMinutes(scheduledFor.getMinutes() + delayMinutes);

            const job = new NotificationJob({
                userId,
                type,
                scheduledFor,
                data
            });

            await job.save();
            console.log(`🕒 Job scheduled: ${type} for user ${userId} at ${scheduledFor.toISOString()}`);
            return job;
        } catch (error) {
            console.error('Job Scheduling Error:', error);
            throw error;
        }
    },

    /**
     * Cancel pending jobs for a user/type
     * e.g. Cancel abandoned cart reminder if user orders
     */
    async cancel(userId, type) {
        try {
            const result = await NotificationJob.updateMany(
                { userId, type, status: 'Pending' },
                { status: 'Completed', error: 'Cancelled by system logic' }
            );
            console.log(`🚫 Cancelled ${result.modifiedCount} pending ${type} jobs for user ${userId}`);
        } catch (error) {
            console.error('Job Cancel Error:', error);
        }
    }
};

module.exports = jobService;
