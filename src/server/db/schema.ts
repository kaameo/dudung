import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  nickname: text('nickname').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const broadcastStatus = pgEnum('broadcast_status', ['READY', 'LIVE', 'ENDED']);
export const broadcastSource = pgEnum('broadcast_source', ['SCREEN', 'CAMERA']);

export const broadcasts = pgTable(
  'broadcasts',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    status: broadcastStatus('status').notNull().default('READY'),
    source: broadcastSource('source'),
    pathName: text('path_name').notNull().unique(),
    startedAt: ts('started_at'),
    firstPublishedAt: ts('first_published_at'),
    endedAt: ts('ended_at'),
    endReason: text('end_reason'),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('one_live_per_owner').on(t.ownerId).where(sql`status = 'LIVE'`),
    index('broadcasts_public')
      .on(t.status, t.createdAt.desc())
      .where(sql`deleted_at IS NULL AND status <> 'READY'`),
    index('broadcasts_by_owner').on(t.ownerId, t.createdAt.desc()).where(sql`deleted_at IS NULL`),
  ],
);

export const recordingStatus = pgEnum('recording_status', ['RECORDING', 'PROCESSING', 'READY', 'FAILED']);

export const recordings = pgTable('recordings', {
  id: uuid('id').primaryKey(),
  broadcastId: uuid('broadcast_id')
    .notNull()
    .unique()
    .references(() => broadcasts.id),
  status: recordingStatus('status').notNull().default('RECORDING'),
  s3Key: text('s3_key'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  durationSec: integer('duration_sec'),
  error: text('error'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey(),
    broadcastId: uuid('broadcast_id')
      .notNull()
      .references(() => broadcasts.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('comments_by_broadcast').on(t.broadcastId, t.id.desc())],
);

export const donationStatus = pgEnum('donation_status', ['PENDING', 'DONE', 'FAILED']);

export const donations = pgTable(
  'donations',
  {
    id: uuid('id').primaryKey(),
    orderId: text('order_id').notNull().unique(),
    broadcastId: uuid('broadcast_id')
      .notNull()
      .references(() => broadcasts.id),
    donorId: uuid('donor_id')
      .notNull()
      .references(() => users.id),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id),
    amount: integer('amount').notNull(),
    message: text('message'),
    status: donationStatus('status').notNull().default('PENDING'),
    paymentKey: text('payment_key').unique(),
    approvedAt: ts('approved_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('donations_amount_range', sql`${t.amount} BETWEEN 1000 AND 100000`),
    index('donations_by_broadcast').on(t.broadcastId).where(sql`status = 'DONE'`),
  ],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    source: text('source').notNull(),
    eventId: text('event_id').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.source, t.eventId] })],
);

export type User = typeof users.$inferSelect;
export type Broadcast = typeof broadcasts.$inferSelect;
export type Recording = typeof recordings.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Donation = typeof donations.$inferSelect;
