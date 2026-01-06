import express from 'express';
import Stripe from 'stripe';
import { authMiddleware } from '../auth.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY?.trim());
const FRONTEND_URL = process.env.FRONTEND_URL;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;

/**
 * POST /checkout/create
 * Create Stripe checkout session (requires auth)
 */
router.post('/create', authMiddleware, async (req, res) => {
    if (!STRIPE_PRICE_ID) {
        return res.status(500).json({ error: 'Stripe price not configured' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            customer_email: req.user.email,
            metadata: {
                email: req.user.email
            },
            line_items: [
                {
                    price: STRIPE_PRICE_ID,
                    quantity: 1,
                },
            ],
            success_url: `${FRONTEND_URL}/privacyInterceptor/checkout/success`,
            cancel_url: `${FRONTEND_URL}/privacyInterceptor`,
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error('Checkout create error:', error);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});

export default router;
