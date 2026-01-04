import express from 'express';
import { Resend } from 'resend';
import { db } from '../db/index.js';
import { users, magicTokens } from '../db/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { generateMagicToken, generateJWT, authMiddleware, verifyJWT } from '../auth.js';

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);
const FRONTEND_URL = process.env.FRONTEND_URL;

/**
 * POST /auth/request
 * Request a magic link email
 */
router.post('/request', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email is required' });
    }

    try {
        // Create or get user
        let user = await db.query.users.findFirst({
            where: eq(users.email, email),
        });

        if (!user) {
            const result = await db.insert(users).values({ email }).returning();
            user = result[0];
        }

        // Generate magic token
        const token = generateMagicToken();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        await db.insert(magicTokens).values({
            email,
            token,
            expiresAt,
        });

        // Send email
        const magicLink = `${FRONTEND_URL}/privacyInterceptor/auth/verify?token=${token}`;

        const { data, error } = await resend.emails.send({
            from: 'Privacy Interceptor <noreply@updates.rhivo.app>',
            to: email,
            subject: 'Sign in to Privacy Interceptor',
            html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="font-size: 20px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Sign in to Privacy Interceptor</h2>
          <p style="font-size: 15px; line-height: 1.6; color: #4a4a4a; margin-bottom: 24px;">Click the link below to sign in. This link expires in 15 minutes.</p>
          <a href="${magicLink}" style="display: inline-block; background: #1a1a1a; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">Sign in</a>
          <p style="font-size: 13px; color: #888; margin-top: 32px;">If you did not request this email, you can ignore it.</p>
        </div>
      `,
        });

        if (error) {
            console.error('Resend error:', error);
            return res.status(500).json({ error: 'Failed to send email', details: error });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Auth request error:', error);
        res.status(500).json({ error: 'Failed to send verification email' });
    }
});

/**
 * POST /auth/verify
 * Verify magic token and return JWT
 */
router.post('/verify', async (req, res) => {
    const { token } = req.body;

    if (!token) {
        return res.status(400).json({ error: 'Token is required' });
    }

    try {
        // Find valid token
        const magicToken = await db.query.magicTokens.findFirst({
            where: and(
                eq(magicTokens.token, token),
                eq(magicTokens.used, false),
                gt(magicTokens.expiresAt, new Date())
            ),
        });

        if (!magicToken) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }

        // Mark token as used
        await db.update(magicTokens)
            .set({ used: true })
            .where(eq(magicTokens.id, magicToken.id));

        // Get user
        const user = await db.query.users.findFirst({
            where: eq(users.email, magicToken.email),
        });

        if (!user) {
            return res.status(400).json({ error: 'User not found' });
        }

        // Generate JWT
        const jwt = generateJWT(user);

        res.json({
            token: jwt,
            user: {
                email: user.email,
                isPremium: user.isPremium,
            },
        });
    } catch (error) {
        console.error('Auth verify error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

/**
 * GET /auth/me
 * Get current user info (requires auth)
 */
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await db.query.users.findFirst({
            where: eq(users.email, req.user.email),
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({
            email: user.email,
            isPremium: user.isPremium,
        });
    } catch (error) {
        console.error('Auth me error:', error);
        res.status(500).json({ error: 'Failed to get user info' });
    }
});

export default router;
