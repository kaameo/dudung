CREATE TYPE "public"."broadcast_source" AS ENUM('SCREEN', 'CAMERA');--> statement-breakpoint
CREATE TYPE "public"."broadcast_status" AS ENUM('READY', 'LIVE', 'ENDED');--> statement-breakpoint
CREATE TYPE "public"."donation_status" AS ENUM('PENDING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."recording_status" AS ENUM('RECORDING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "broadcast_status" DEFAULT 'READY' NOT NULL,
	"source" "broadcast_source",
	"path_name" text NOT NULL,
	"started_at" timestamp with time zone,
	"first_published_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcasts_path_name_unique" UNIQUE("path_name")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"donor_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"message" text,
	"status" "donation_status" DEFAULT 'PENDING' NOT NULL,
	"payment_key" text,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "donations_payment_key_unique" UNIQUE("payment_key"),
	CONSTRAINT "donations_amount_range" CHECK ("donations"."amount" BETWEEN 1000 AND 100000)
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"status" "recording_status" DEFAULT 'RECORDING' NOT NULL,
	"s3_key" text,
	"size_bytes" bigint,
	"duration_sec" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recordings_broadcast_id_unique" UNIQUE("broadcast_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"nickname" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_nickname_unique" UNIQUE("nickname")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"source" text NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_events_source_event_id_pk" PRIMARY KEY("source","event_id")
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_id_users_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_broadcast_id_broadcasts_id_fk" FOREIGN KEY ("broadcast_id") REFERENCES "public"."broadcasts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_per_owner" ON "broadcasts" USING btree ("owner_id") WHERE status = 'LIVE';--> statement-breakpoint
CREATE INDEX "broadcasts_public" ON "broadcasts" USING btree ("status","created_at" DESC NULLS LAST) WHERE deleted_at IS NULL AND status <> 'READY';--> statement-breakpoint
CREATE INDEX "broadcasts_by_owner" ON "broadcasts" USING btree ("owner_id","created_at" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "comments_by_broadcast" ON "comments" USING btree ("broadcast_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "donations_by_broadcast" ON "donations" USING btree ("broadcast_id") WHERE status = 'DONE';