import { pgTable, serial, varchar, boolean, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('user', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordhash: varchar('passwordhash', { length: 255 }),
  isPremium: boolean('isPremium').default(false).notNull(),
});

export const magicTokens = pgTable('magic_token', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  token: varchar('token', { length: 64 }).unique().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').default(false).notNull(),
});
