CREATE TABLE "apikey" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used" timestamp with time zone,
	CONSTRAINT "apikey_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "image" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created" timestamp with time zone DEFAULT now() NOT NULL,
	"file_name" text DEFAULT 'image' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_derivative" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" text NOT NULL,
	"key" text NOT NULL,
	"filetype" text NOT NULL,
	"last_read" timestamp with time zone DEFAULT now() NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "image_derivative_image_id_key_unique" UNIQUE("image_id","key")
);
--> statement-breakpoint
CREATE TABLE "image_file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" text NOT NULL,
	"variant" text NOT NULL,
	"filetype" text NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "image_file_image_id_variant_unique" UNIQUE("image_id","variant")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"keep_original" boolean DEFAULT false NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image" ADD CONSTRAINT "image_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_derivative" ADD CONSTRAINT "image_derivative_image_id_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."image"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_file" ADD CONSTRAINT "image_file_image_id_image_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."image"("id") ON DELETE cascade ON UPDATE no action;