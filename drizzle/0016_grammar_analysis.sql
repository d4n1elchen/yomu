CREATE TABLE `grammar_analysis` (
	`sentence_id` text PRIMARY KEY NOT NULL,
	`sentence_revision` integer NOT NULL,
	`version` text NOT NULL,
	`points` text NOT NULL,
	`others` text NOT NULL,
	`analysed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`sentence_id`) REFERENCES `sentence`(`id`) ON UPDATE no action ON DELETE cascade
);
