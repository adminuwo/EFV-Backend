require('dotenv').config();
const sendEmail = require('./utils/emailService');

async function test() {
    try {
        console.log('Testing email service...');
        console.log('EMAIL_USER:', process.env.EMAIL_USER);
        // Do NOT log password for security, but check if it exists
        console.log('EMAIL_PASS exists:', !!process.env.EMAIL_PASS);

        await sendEmail({
            email: process.env.EMAIL_USER, // Send to self
            subject: 'Test Email from EFV',
            html: '<h1>Test</h1><p>This is a test email.</p>'
        });
        console.log('✅ Email sent successfully!');
    } catch (error) {
        console.error('❌ Email sending failed:', error);
    }
}

test();
