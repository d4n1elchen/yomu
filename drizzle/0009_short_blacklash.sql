ALTER TABLE `section` ADD `resolved_at` integer;--> statement-breakpoint
ALTER TABLE `section` ADD `resolve_total` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `section` ADD `resolve_done` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing sections were imported when resolution ran synchronously, so they are
-- already resolved. Without this they would all read as pending and the Library
-- would grey every article it has.
UPDATE `section` SET `resolved_at` = coalesce(`tokenized_at`, unixepoch())
  WHERE `resolved_at` IS NULL;
