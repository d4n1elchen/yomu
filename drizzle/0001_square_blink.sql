CREATE TABLE `question` (
	`id` text PRIMARY KEY NOT NULL,
	`sentence_id` text NOT NULL,
	`sentence_revision` integer NOT NULL,
	`char_start` integer,
	`char_end` integer,
	`prompt` text NOT NULL,
	`answer` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`sentence_id`) REFERENCES `sentence`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_sentence_idx` ON `question` (`sentence_id`,`created_at`);