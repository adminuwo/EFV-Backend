const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const sendEmail = require('../utils/emailService');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'secret123', { expiresIn: '365d' });
};

// --- USER REGISTRATION (SIGNUP) ---
router.post('/register', async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;

        // Basic Validation
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Name, email and password are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        // Check uniqueness
        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: 'Email already registered' });
        }

        // Hash Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create User
        const user = await User.create({
            name,
            email,
            phone: phone || '',
            password: hashedPassword,
            role: 'user',
            notifications: [{
                type: 'Digital',
                title: `Welcome to EFV, ${name}! 🚀`,
                message: "Your journey starts here. Explore our marketplace and build your personal library.",
                isRead: false,
                createdAt: new Date().toISOString()
            }]
        });

        // Response with Token
        res.status(201).json({
            message: 'User registered successfully',
            _id: user._id,
            name: user.name,
            email: user.email,
            token: generateToken(user._id)
        });

    } catch (error) {
        console.error('Signup Error:', error);
        res.status(400).json({ message: error.message || 'Error creating user' });
    }
});

// legacy path support
router.post('/signup', (req, res) => {
    res.redirect(307, '/api/auth/register');
});

// --- USER LOGIN ---
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ message: 'No account found with this email' });
        }

        // Verify Password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Incorrect password' });
        }

        // Ensure Welcome notification exists (for existing users)
        if (!user.notifications) user.notifications = [];
        const hasWelcome = user.notifications.some(n =>
            (n.title || '').toLowerCase().includes('welcome') || (n.message || '').toLowerCase().includes('welcome')
        );
        if (!hasWelcome) {
            user.notifications.unshift({
                type: 'Digital',
                title: `Welcome to EFV, ${user.name}! 🚀`,
                message: "Your journey starts here. Explore our marketplace and build your personal library.",
                isRead: true,
                createdAt: new Date(0).toISOString() // oldest date so it sorts last in regular sort
            });
            await user.save();
        }

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            token: generateToken(user._id)
        });

    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ message: 'Internal server error during login' });
    }
});

// --- PASSWORD SECURITY ---
router.put('/change-password', require('../middleware/auth').protect, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ message: 'Both old and new passwords are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters' });
        }

        const user = await User.findById(req.user._id);

        // Verify Old Password
        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Old password does not match' });
        }

        // Hash and Save New Password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();

        res.json({ message: 'Password updated successfully' });

    } catch (error) {
        console.error('Pass Update Error:', error);
        res.status(500).json({ message: 'Error updating password' });
    }
});

// --- GOOGLE LOGIN ---
router.post('/google', async (req, res) => {
    try {
        const { idToken } = req.body;
        console.log('Received Google Token attempt...');
        if (!idToken) {
            console.warn('No idToken received');
            return res.status(400).json({ message: 'Token is required' });
        }

        console.log('Verifying with Client ID:', process.env.GOOGLE_CLIENT_ID);

        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        console.log('Google Payload:', payload.email);
        const { sub: googleId, email, name, picture } = payload;

        // Check if user exists
        let user = await User.findOne({ email });

        if (!user) {
            // Create user (Just-in-time)
            user = await User.create({
                name: name || 'Google User',
                email,
                password: await bcrypt.hash(Math.random().toString(36), 10), // Random pass
                role: 'user',
                googleId,
                avatar: picture,
                notifications: [{
                    type: 'Digital',
                    title: `Welcome, ${name}! 🚀`,
                    message: "You've successfully connected with Google. Explore your secure library.",
                    isRead: false,
                    createdAt: new Date().toISOString()
                }]
            });
        } else {
            // Update googleId if not present
            if (!user.googleId) {
                user.googleId = googleId;
            }
            // Ensure Welcome notification exists for existing Google users
            if (!user.notifications) user.notifications = [];
            const hasWelcome = user.notifications.some(n =>
                (n.title || '').toLowerCase().includes('welcome') || (n.message || '').toLowerCase().includes('welcome')
            );
            if (!hasWelcome) {
                user.notifications.unshift({
                    type: 'Digital',
                    title: `Welcome, ${user.name}! 🚀`,
                    message: "You've successfully connected with Google. Explore your secure library.",
                    isRead: true,
                    createdAt: new Date(0).toISOString()
                });
            }
            await user.save();
        }

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            avatar: user.avatar,
            token: generateToken(user._id)
        });

    } catch (error) {
        console.error('Google Auth Error:', error);
        res.status(401).json({ message: 'Invalid Google token' });
    }
});

router.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const admin = await User.findOne({ email, role: 'admin' });

        if (admin && (await bcrypt.compare(password, admin.password))) {
            res.json({
                _id: admin._id,
                name: admin.name,
                email: admin.email,
                role: 'admin',
                token: generateToken(admin._id)
            });
        } else {
            res.status(401).json({ message: 'Invalid admin credentials' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during admin login' });
    }
});

// --- FORGOT PASSWORD ---
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email is required' });

        const searchEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: searchEmail });

        // Security: Always return success even if user not found
        const successResponse = { message: 'If your email is registered, a reset code has been sent.' };

        if (!user) {
            return res.json(successResponse);
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Hash OTP before storing
        const salt = await bcrypt.genSalt(10);
        user.resetPasswordOTP = await bcrypt.hash(otp, salt);
        user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        user.resetAttempts = 0;
        await user.save();

        // Send Email
        try {
            await sendEmail({
                email: user.email,
                subject: 'Reset your password - EFV™',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #000; color: #fff; border: 1px solid #FFD369; border-radius: 10px;">
                        <h2 style="color: #FFD369; text-align: center;">EFV™ Password Reset</h2>
                        <p>You requested a password reset. Use the following 6-digit code to proceed:</p>
                        <div style="background: rgba(255, 211, 105, 0.1); padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #FFD369;">${otp}</span>
                        </div>
                        <p style="color: #ccc; font-size: 14px; text-align: center;">This code will expire in 10 minutes.</p>
                        <p style="margin-top: 30px; font-size: 12px; opacity: 0.6; text-align: center;">If you didn't request this, please ignore this email.</p>
                    </div>
                `
            });
            res.json(successResponse);
        } catch (emailError) {
            console.error('CRITICAL: Email Send Error Details:', {
                message: emailError.message,
                code: emailError.code,
                command: emailError.command,
                response: emailError.response
            });
            res.status(500).json({ message: 'Error sending reset email', details: emailError.message });
        }

    } catch (error) {
        console.error('Forgot Pass Error:', error);
        try {
            require('fs').appendFileSync(require('path').join(__dirname, '../data/auth_debug.log'), `[${new Date().toISOString()}] Forgot Pass Error: ${error.message}\n${error.stack}\n`);
        } catch (e) {}
        res.status(500).json({ message: 'Internal server error', details: error.message });
    }
});

// --- VERIFY OTP ---
router.post('/verify-reset-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required' });

        const searchEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: searchEmail });
        if (!user || !user.resetPasswordOTP || !user.resetPasswordExpires) {
            return res.status(400).json({ message: 'Invalid or expired reset request' });
        }

        // Check expiry — handle both numeric timestamp and ISO string (JSON DB)
        const expiry = new Date(user.resetPasswordExpires).getTime();
        if (Date.now() > expiry) {
            return res.status(400).json({ message: 'OTP has expired. Please request a new code.' });
        }

        // Check attempts
        if (user.resetAttempts >= 5) {
            return res.status(400).json({ message: 'Too many incorrect attempts. Please request a new code.' });
        }

        // Verify OTP
        const isMatch = await bcrypt.compare(otp, user.resetPasswordOTP);
        if (!isMatch) {
            user.resetAttempts = (user.resetAttempts || 0) + 1;
            await user.save();
            return res.status(400).json({ message: 'Incorrect OTP' });
        }

        // Valid OTP -> Generate short-lived reset token
        const resetToken = jwt.sign(
            { id: user._id, type: 'reset' },
            process.env.JWT_SECRET || 'secret123',
            { expiresIn: '10m' }
        );

        res.json({ resetToken });

    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// --- RESET PASSWORD ---
router.post('/reset-password', async (req, res) => {
    try {
        const { resetToken, newPassword } = req.body;
        if (!resetToken || !newPassword) {
            return res.status(400).json({ message: 'Token and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        // Verify Token
        let decoded;
        try {
            decoded = jwt.verify(resetToken, process.env.JWT_SECRET || 'secret123');
            if (decoded.type !== 'reset') throw new Error('Invalid token type');
        } catch (err) {
            return res.status(400).json({ message: 'Invalid or expired reset token' });
        }

        const user = await User.findById(decoded.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Update Password
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);

        // Clear reset fields — use null so JSON DB correctly serializes the removal
        user.resetPasswordOTP = null;
        user.resetPasswordExpires = null;
        user.resetAttempts = null;

        await user.save();

        res.json({ message: 'Password reset successful' });

    } catch (error) {
        console.error('Reset Pass Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
