CREATE TABLE `grammar_connection` (
	`code` text PRIMARY KEY NOT NULL,
	`rows` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `grammar_form` (
	`point_id` text NOT NULL,
	`units` text NOT NULL,
	`first_unit` text NOT NULL,
	`left` text,
	`right` text,
	PRIMARY KEY(`point_id`, `units`, `left`, `right`),
	FOREIGN KEY (`point_id`) REFERENCES `grammar_point`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `grammar_form_first_idx` ON `grammar_form` (`first_unit`);--> statement-breakpoint
CREATE TABLE `grammar_point` (
	`id` text PRIMARY KEY NOT NULL,
	`base` text NOT NULL,
	`difficulty` text NOT NULL,
	`meaning_class` text NOT NULL,
	`meaning_name` text NOT NULL,
	`name_zh` text,
	`gloss_zh` text,
	`gloss_model` text
);
--> statement-breakpoint
CREATE INDEX `grammar_point_class_idx` ON `grammar_point` (`meaning_class`);--> statement-breakpoint
CREATE INDEX `grammar_point_gloss_idx` ON `grammar_point` (`name_zh`);--> statement-breakpoint
CREATE INDEX `grammar_point_difficulty_idx` ON `grammar_point` (`difficulty`);