const { Job, Cart, User, Product, SystemSettings } = require('../models');
const whatsappService = require('./whatsappService');

/**
 * Background Worker for Processing Delayed Notifications
 * Run every 1-2 minutes to check for pending jobs and abandoned carts.
 */
class NotificationWorker {
    /**
     * Start the worker
     * @param {number} intervalSeconds Frequency (default 60s)
     */
    start(intervalSeconds = 60) {
        console.log('🚀 Notification Worker Started (Running Every ' + intervalSeconds + 's)');
        setInterval(() => this.tick(), intervalSeconds * 1000);
    }

    async tick() {
        try {
            // 1. Process Scheduled Jobs (Order Confirmations, etc.)
            await this.processScheduledJobs();

            // 2. Identify Abandoned Carts & Create Recovery Jobs
            await this.checkAbandonedCarts();
        } catch (error) {
            console.error('❌ Worker Tick Error:', error);
        }
    }

    /**
     * Process Pending Scheduled Jobs
     */
    async processScheduledJobs() {
        try {
            const pendingJobs = await Job.find({
                status: 'Pending',
                scheduledFor: { $lte: new Date() }
            }).limit(10); // Process in batches

            for (const job of pendingJobs) {
                try {
                    console.log(`📡 Processing scheduled job ${job.type} for ${job.userId}...`);
                    
                    // Check Admin Settings
                    if (job.type === 'OrderPlaced') {
                        const settings = await SystemSettings.findOne({ key: 'whatsapp_order_jobs' });
                        if (settings && settings.value === false) {
                            job.status = 'Completed';
                            job.error = 'Disabled by Admin';
                            await job.save();
                            continue;
                        }
                    }

                    if (job.type === 'OrderPlaced' || job.type === 'AbandonedCart') {
                        // All these go via WhatsApp (with retry handling)
                        const success = await whatsappService.processJob(job);
                        
                        if (success) {
                            job.status = 'Completed';
                            job.processedAt = new Date();
                        } else {
                            job.attempts += 1;
                            if (job.attempts >= 3) {
                                job.status = 'Failed';
                                job.error = 'Max attempts reached';
                            }
                        }
                    }

                    await job.save();
                } catch (err) {
                    console.error('Error processing specific job:', err);
                }
            }
        } catch (err) {
            console.error('Worker Job Error:', err);
        }
    }

    /**
     * Logic for Abandoned Cart Detection
     * - Reminder 1: after 24 hrs
     * - Reminder 2: after 48-72 hrs (we'll check if still not purchased)
     */
    async checkAbandonedCarts() {
        try {
            const now = new Date();
            
            // Check Admin Settings if recovery is enabled
            const settings = await SystemSettings.findOne({ key: 'whatsapp_cart_recovery' });
            if (settings && settings.value === false) return;

            // 🛠️ REMINDER 1: 24 Hours after last sync
            const dayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
            
            const carts = await Cart.find({
                isPurchased: false,
                remindersSent: 0,
                lastSyncedAt: { $lte: dayAgo },
                items: { $not: { $size: 0 } } // Not empty
            });

            for (const cart of carts) {
                console.log(`🛒 Found abandoned cart (Reminder 1) for user ${cart.userId}`);
                await this.scheduleCartRecovery(cart, 1);
            }

            // 🛠️ REMINDER 2: 48 Hours after last reminder (if still not purchased)
            const twoDaysAgoFromLastReminder = new Date(now.getTime() - (48 * 60 * 60 * 1000));
            const carts2 = await Cart.find({
                isPurchased: false,
                remindersSent: 1,
                lastReminderAt: { $lte: twoDaysAgoFromLastReminder },
                items: { $not: { $size: 0 } }
            });

            for (const cart of carts2) {
                console.log(`🛒 Found abandoned cart (Reminder 2) for user ${cart.userId}`);
                await this.scheduleCartRecovery(cart, 2);
            }

        } catch (err) {
            console.error('Abandoned Cart Check Error:', err);
        }
    }

    async scheduleCartRecovery(cart, reminderNo) {
        try {
            // Update cart to avoid duplicate scheduling
            cart.remindersSent = reminderNo;
            cart.lastReminderAt = new Date();
            await cart.save();

            // Create immediate notification job
            const job = new Job({
                userId: cart.userId,
                type: 'AbandonedCart',
                scheduledFor: new Date(), // Immediate (will be picked by next job loop)
                data: {
                    reminderNo: reminderNo,
                    itemsCount: cart.items.length
                }
            });

            await job.save();
        } catch (err) {
            console.error('Schedule Recovery Error:', err);
        }
    }
}

module.exports = new NotificationWorker();
