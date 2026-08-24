CREATE TABLE `dict_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`freq_band` integer,
	`headword` text NOT NULL,
	`reading` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dict_entry_band_idx` ON `dict_entry` (`freq_band`);--> statement-breakpoint
CREATE TABLE `dict_form` (
	`entry_id` text NOT NULL,
	`text` text NOT NULL,
	`reading` text NOT NULL,
	PRIMARY KEY(`text`, `reading`, `entry_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `dict_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dict_sense` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`pos` text NOT NULL,
	`gloss_en` text NOT NULL,
	`gloss_zh` text,
	`gloss_model` text,
	FOREIGN KEY (`entry_id`) REFERENCES `dict_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dict_sense_entry_idx` ON `dict_sense` (`entry_id`,`order_index`);--> statement-breakpoint
CREATE INDEX `dict_sense_untranslated_idx` ON `dict_sense` (`gloss_zh`);--> statement-breakpoint
ALTER TABLE `lexeme` ADD `dict_entry_id` text REFERENCES dict_entry(id);--> statement-breakpoint
ALTER TABLE `lexeme` ADD `dict_match` text;--> statement-breakpoint
CREATE INDEX `lexeme_dict_idx` ON `lexeme` (`dict_entry_id`);