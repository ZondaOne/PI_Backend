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

const corsOptions = {
  origin: [
    'http://localhost:3000',
    'https://zonda.one',
    'https://www.zonda.one',
    process.env.FRONTEND_URL,
  ].filter(Boolean),
  credentials: true,
};

app.post('/update-status', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!endpointSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not defined in environment variables');
    return res.status(500).send('Webhook Secret missing');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`Webhook received: ${event.type}`);

  const handleStatusUpdate = async (identifier, isPremium, findBy = 'email') => {
    if (!identifier) {
      console.warn(`No ${findBy} found in event for status update`);
      return null;
    }

    const idClean = typeof identifier === 'string' ? identifier.trim() : identifier;

    let condition;
    if (findBy === 'email') {
      condition = eq(users.email, idClean);
    } else if (findBy === 'chargeId') {
      condition = eq(users.stripeChargeId, idClean);
    } else if (findBy === 'paymentIntent') {
      condition = eq(users.stripePaymentIntentId, idClean);
    } else {
      condition = eq(users.stripeChargeId, idClean);
    }

    try {
      const result = await db.update(users)
        .set({ isPremium })
        .where(condition);

      // Log rowCount clearly so you can see whether match happened
      console.log(`DB update result for ${idClean} via ${findBy} (isPremium: ${isPremium}):`, result);
      return result;
    } catch (dbErr) {
      console.error('Database update error:', dbErr);
      return null;
    }
  };

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const customerEmail = (session.customer_email || session.metadata?.email || '').trim() || null;

      // Normalize payment_intent id whether session contains string or object
      const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id;

      let chargeId = null;
      if (paymentIntentId) {
        try {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ['latest_charge'],
          });
          chargeId = pi.latest_charge?.id || null;
        } catch (err) {
          console.error('Error retrieving PaymentIntent to get charge ID:', err);
        }
      } else {
        // fallback: sometimes session may already include expanded payment_intent.latest_charge
        chargeId = session.payment_intent?.latest_charge?.id || null;
      }

      const chargeIdClean = chargeId?.trim() || null;
      console.log(`Processing checkout.session.completed for email: ${customerEmail}, payment_intent: ${paymentIntentId}, charge: ${chargeIdClean}`);

      if (customerEmail) {
        try {
          await db.update(users)
            .set({
              isPremium: true,
              stripeChargeId: chargeIdClean,
              stripePaymentIntentId: paymentIntentId?.trim() || null
            })
            .where(eq(users.email, customerEmail));
        } catch (err) {
          console.error('Failed to update user premium status:', err);
        }
      }

    } else if (event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
      const dispute = event.data.object;
      const chargeId = dispute.charge ? (dispute.charge.trim?.() ?? dispute.charge) : null;
      const paymentIntentId = dispute.payment_intent ? (dispute.payment_intent.trim?.() ?? dispute.payment_intent) : null;

      console.log(`Processing ${event.type} for dispute: ${dispute.id}, charge: ${chargeId}, payment_intent: ${paymentIntentId}, status: ${dispute.status}`);

      if (chargeId) {
        await handleStatusUpdate(chargeId, event.type === 'charge.dispute.closed' && dispute.status === 'won' ? true : false, 'chargeId');
      } else if (paymentIntentId) {
        // If dispute references payment_intent instead of charge, try matching by PI
        await handleStatusUpdate(paymentIntentId, event.type === 'charge.dispute.closed' && dispute.status === 'won' ? true : false, 'paymentIntent');
      } else {
        console.warn('Dispute does not contain charge or payment_intent; no action taken.');
      }

    } else if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const chargeId = charge.id?.trim?.();
      if (charge.refunded) {
        console.log(`Full refund detected for charge: ${chargeId}. Revoking premium.`);
        await handleStatusUpdate(chargeId, false, 'chargeId');
      } else {
        console.log(`Partial refund detected for charge: ${chargeId}. Keeping premium.`);
      }

    } else if (event.type === 'refund.created') {
      const refund = event.data.object;
      console.log(`Refund created: ${refund.id} for charge: ${refund.charge}. Status: ${refund.status}`);
    } else {
      console.log('Unhandled event type:', event.type);
    }
  } catch (err) {
    console.error('Error processing webhook event:', err);
  }

  res.json({ received: true });
});

app.use(express.json());
app.use(cors(corsOptions));

app.use('/auth', authRoutes);
app.use('/checkout', checkoutRoutes);

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
