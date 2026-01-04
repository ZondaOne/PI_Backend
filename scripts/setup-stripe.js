import Stripe from 'stripe';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

if (!process.env.STRIPE_SECRET_KEY) {
    console.error('Error: STRIPE_SECRET_KEY not found in .env');
    process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function setupStripe() {
    console.log('Creating "Privacy Interceptor Premium" product...');

    try {
        // 1. Create the Product
        const product = await stripe.products.create({
            name: 'Privacy Interceptor Premium',
            description: 'Lifetime access to all premium privacy features, including unlimited OCR and advanced redaction.',
            // images: [ 'TODO: User will upload the generated banner here' ], // We'll skip image for now as we don't have a public URL
        });

        console.log(`✅ Product created: ${product.name} (${product.id})`);

        // 2. Create Standard Price (2.99 EUR)
        const standardPrice = await stripe.prices.create({
            product: product.id,
            unit_amount: 299, // 2.99 EUR in cents
            currency: 'eur',
            // recurring: undefined, // One-time payment
        });

        console.log(`✅ Standard Price created: €2.99 (${standardPrice.id})`);

        // 3. Create Early Bird Price (0.99 EUR)
        const earlyBirdPrice = await stripe.prices.create({
            product: product.id,
            unit_amount: 99, // 0.99 EUR in cents
            currency: 'eur',
            nickname: 'Early Bird',
        });

        console.log(`✅ Early Bird Price created: €0.99 (${earlyBirdPrice.id})`);

        console.log('\n-----------------------------------');
        console.log('SETUP COMPLETE');
        console.log('-----------------------------------');
        console.log(`To use the **Early Bird** price, add this to your .env:`);
        console.log(`STRIPE_PRICE_ID=${earlyBirdPrice.id}`);
        console.log(`\nTo switch to **Standard** price later, update .env to:`);
        console.log(`STRIPE_PRICE_ID=${standardPrice.id}`);

    } catch (error) {
        console.error('Stripe setup failed:', error.message);
    }
}

setupStripe();
