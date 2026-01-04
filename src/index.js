import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import { db } from './db/index.js';
import { users } from './db/schema.js';
import { eq } from 'drizzle-orm';
import authRoutes from './routes/auth.js';
import checkoutRoutes from './routes/checkout.js';

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'https://zonda.one',
    'https://www.zonda.one',
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
};

// Webhook needs raw body - must be before express.json()
app.post('/update-status', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_details.email;

    try {
      await db.update(users)
        .set({ isPremium: true })
        .where(eq(users.email, customerEmail));

      console.log(`Updated premium status for ${customerEmail}`);
    } catch (dbErr) {
      console.error('Database update error:', dbErr);
      return res.status(500).send('Database error');
    }
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(cors(corsOptions));

// Routes
app.use('/auth', authRoutes);
app.use('/checkout', checkoutRoutes);

// Legacy endpoint for checking status by email (used by extension)
app.post('/check-status', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      return res.json({ active: false, status: 'User not found' });
    }

    res.json({ active: user.isPremium });
  } catch (error) {
    console.error('Check status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
