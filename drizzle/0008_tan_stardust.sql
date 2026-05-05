ALTER TABLE `chats` ADD `parent_chat_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `forked_at_commit` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `forked_at_message_index` integer;--> statement-breakpoint
ALTER TABLE `chats` ADD `direction_color` text;--> statement-breakpoint
CREATE INDEX `chats_parent_chat_id_idx` ON `chats` (`parent_chat_id`);