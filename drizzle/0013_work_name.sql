CREATE TABLE `work_name` (
	`work_id` text NOT NULL,
	`surface` text NOT NULL,
	`reading` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`work_id`, `surface`),
	FOREIGN KEY (`work_id`) REFERENCES `work`(`id`) ON UPDATE no action ON DELETE cascade
);
