CREATE TABLE `lexeme` (
	`id` text PRIMARY KEY NOT NULL,
	`dictionary` text NOT NULL,
	`lemma` text NOT NULL,
	`reading` text NOT NULL,
	`pos` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lexeme_key_idx` ON `lexeme` (`dictionary`,`lemma`,`reading`,`pos`);--> statement-breakpoint
CREATE TABLE `section` (
	`id` text PRIMARY KEY NOT NULL,
	`work_id` text NOT NULL,
	`parent_id` text,
	`order_index` integer NOT NULL,
	`title` text,
	`source_text` text,
	`origin` text DEFAULT 'text' NOT NULL,
	`edit_state` text DEFAULT 'editable' NOT NULL,
	`analyzer_id` text NOT NULL,
	`analyzer_version` text NOT NULL,
	`tokenized_at` integer,
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `section_work_idx` ON `section` (`work_id`,`parent_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `sentence` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`text` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL,
	`confidence` real,
	`start_ms` integer,
	`end_ms` integer,
	`edited_at` integer,
	FOREIGN KEY (`section_id`) REFERENCES `section`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sentence_section_idx` ON `sentence` (`section_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `token` (
	`id` text PRIMARY KEY NOT NULL,
	`sentence_id` text NOT NULL,
	`lexeme_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`char_start` integer NOT NULL,
	`char_end` integer NOT NULL,
	`surface` text NOT NULL,
	`reading` text,
	`features` text NOT NULL,
	FOREIGN KEY (`sentence_id`) REFERENCES `sentence`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexeme`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `token_lexeme_idx` ON `token` (`lexeme_id`);--> statement-breakpoint
CREATE INDEX `token_sentence_idx` ON `token` (`sentence_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `work` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`source_type` text NOT NULL,
	`source_url` text,
	`language` text DEFAULT 'ja' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
