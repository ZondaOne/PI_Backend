import { pgTable, serial, varchar, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('user', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordhash: varchar('passwordhash', { length: 255 }).notNull(),
  isPremium: boolean('isPremium').default(false).notNull(),
});
