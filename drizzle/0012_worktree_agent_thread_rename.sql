PRAGMA foreign_keys = ON;--> statement-breakpoint
PRAGMA legacy_alter_table = OFF;--> statement-breakpoint
ALTER TABLE `chats` RENAME TO `worktrees`;--> statement-breakpoint
ALTER TABLE `sub_chats` RENAME TO `agent_threads`;--> statement-breakpoint
ALTER TABLE `worktrees` RENAME COLUMN `parent_chat_id` TO `parent_worktree_id`;--> statement-breakpoint
ALTER TABLE `agent_threads` RENAME COLUMN `chat_id` TO `worktree_id`;--> statement-breakpoint
ALTER TABLE `canvas_documents` RENAME COLUMN `chat_id` TO `worktree_id`;--> statement-breakpoint
ALTER TABLE `canvas_assets` RENAME COLUMN `chat_id` TO `worktree_id`;--> statement-breakpoint
DROP INDEX IF EXISTS `chats_worktree_path_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `chats_parent_chat_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `canvas_documents_chat_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `canvas_assets_chat_id_idx`;--> statement-breakpoint
CREATE INDEX `worktrees_worktree_path_idx` ON `worktrees` (`worktree_path`);--> statement-breakpoint
CREATE INDEX `worktrees_parent_worktree_id_idx` ON `worktrees` (`parent_worktree_id`);--> statement-breakpoint
CREATE INDEX `canvas_documents_worktree_id_idx` ON `canvas_documents` (`worktree_id`);--> statement-breakpoint
CREATE INDEX `canvas_assets_worktree_id_idx` ON `canvas_assets` (`worktree_id`);
