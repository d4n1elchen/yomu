CREATE TABLE `grammar_occurrence` (
	`point_id` text NOT NULL,
	`sentence_id` text NOT NULL,
	`sentence_revision` integer NOT NULL,
	`char_start` integer NOT NULL,
	`char_end` integer NOT NULL,
	`surface` text NOT NULL,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`point_id`, `sentence_id`),
	FOREIGN KEY (`sentence_id`) REFERENCES `sentence`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grammar_occurrence_sentence_idx` ON `grammar_occurrence` (`sentence_id`);--> statement-breakpoint
CREATE TABLE `user_grammar_state` (
	`point_id` text PRIMARY KEY NOT NULL,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	`familiarity` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at` integer,
	`srs_due` integer
);
