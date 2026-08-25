CREATE TABLE `user_lexeme_state` (
	`lexeme_id` text PRIMARY KEY NOT NULL,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL,
	`familiarity` integer DEFAULT 0 NOT NULL,
	`last_reviewed_at` integer,
	`srs_due` integer,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexeme`(`id`) ON UPDATE no action ON DELETE cascade
);
