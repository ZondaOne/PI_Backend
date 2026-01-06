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
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY?.trim());
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
  console.log(`Webhook received: ${event.type}`);

  const handleStatusUpdate = async (identifier, isPremium, findBy = 'email') => {
    if (!identifier) {
      console.warn(`No ${findBy} found in event for status update`);
      return;
    }
    try {
      const condition = findBy === 'email' ? eq(users.email, identifier) : eq(users.stripeChargeId, identifier);
      const result = await db.update(users)
        .set({ isPremium })
        .where(condition);
      console.log(`DB update result for ${identifier} via ${findBy} (isPremium: ${isPremium}):`, result);
    } catch (dbErr) {
      console.error('Database update error:', dbErr);
    }
  };

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerEmail = session.customer_email;
    const paymentIntentId = session.payment_intent;
    
    // Attempt to get the charge ID if it's available directly, 
    // though usually we'll need to expand or use PI.
    // However, for simplicity and reliability, we can store PI or wait for charge.succeeded
    // but standard disputes refer to the Charge ID.
    // Let's get the charge ID from the session if possible.
    
    let chargeId = null;
    if (session.payment_status === 'paid') {
      try {
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['payment_intent.latest_charge'],
        });
        chargeId = fullSession.payment_intent?.latest_charge?.id;
      } catch (err) {
        console.error('Error retrieving session for charge ID:', err);
      }
    }

    console.log(`Processing checkout.session.completed for email: ${customerEmail}, charge: ${chargeId}`);
    
    // Update premium status and store chargeId
    try {
      await db.update(users)
        .set({ isPremium: true, stripeChargeId: chargeId })
        .where(eq(users.email, customerEmail));
    } catch (err) {
      console.error('Failed to update user premium status/chargeId:', err);
    }

  } else if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object;
    const chargeId = dispute.charge; // This is the ID we stored
    console.log(`Processing charge.dispute.created for charge: ${chargeId}`);
    await handleStatusUpdate(chargeId, false, 'chargeId');
  } else if (event.type === 'charge.dispute.closed') {
    const dispute = event.data.object;
    const chargeId = dispute.charge;
    console.log(`Processing charge.dispute.closed for charge: ${chargeId}, status: ${dispute.status}`);
    
    // If we won the dispute, restore premium status
    if (dispute.status === 'won') {
      await handleStatusUpdate(chargeId, true, 'chargeId');
    }
  } else if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    const chargeId = charge.id;
    console.log(`Processing charge.refunded for charge: ${chargeId}`);
    await handleStatusUpdate(chargeId, false, 'chargeId');
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
