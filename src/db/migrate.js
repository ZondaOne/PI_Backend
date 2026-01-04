import { db } from './index.js';
import { migrate } from 'drizzle-orm/neon-http/migrator';

const main = async () => {
  try {
    console.log('Running migrations...');
    await migrate(db, { migrationsFolder: 'migrations' });
    console.log('Migrations completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

main();
