CREATE TABLE `canvas_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`name` text DEFAULT 'main' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_documents_chat_id_idx` ON `canvas_documents` (`chat_id`);
--> statement-breakpoint
CREATE TABLE `canvas_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`kind` text DEFAULT 'imported' NOT NULL,
	`project_relative_path` text NOT NULL,
	`source_path` text,
	`mime_type` text NOT NULL,
	`byte_size` integer DEFAULT 0 NOT NULL,
	`sha256` text,
	`width` integer,
	`height` integer,
	`created_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_assets_chat_id_idx` ON `canvas_assets` (`chat_id`);
--> statement-breakpoint
CREATE INDEX `canvas_assets_project_relative_path_idx` ON `canvas_assets` (`project_relative_path`);
--> statement-breakpoint
CREATE TABLE `canvas_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`type` text NOT NULL,
	`x` integer DEFAULT 0 NOT NULL,
	`y` integer DEFAULT 0 NOT NULL,
	`width` integer DEFAULT 360 NOT NULL,
	`height` integer DEFAULT 240 NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_nodes_canvas_id_idx` ON `canvas_nodes` (`canvas_id`);
--> statement-breakpoint
CREATE TABLE `canvas_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`source_handle` text NOT NULL,
	`target_node_id` text NOT NULL,
	`target_handle` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_node_id`) REFERENCES `canvas_nodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_node_id`) REFERENCES `canvas_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_edges_canvas_id_idx` ON `canvas_edges` (`canvas_id`);
--> statement-breakpoint
CREATE INDEX `canvas_edges_source_node_id_idx` ON `canvas_edges` (`source_node_id`);
--> statement-breakpoint
CREATE INDEX `canvas_edges_target_node_id_idx` ON `canvas_edges` (`target_node_id`);
--> statement-breakpoint
CREATE TABLE `canvas_generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`canvas_id` text NOT NULL,
	`node_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`prompt` text,
	`input_asset_ids` text DEFAULT '[]' NOT NULL,
	`output_asset_id` text,
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`canvas_id`) REFERENCES `canvas_documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`node_id`) REFERENCES `canvas_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `canvas_generation_runs_canvas_id_idx` ON `canvas_generation_runs` (`canvas_id`);
--> statement-breakpoint
CREATE INDEX `canvas_generation_runs_node_id_idx` ON `canvas_generation_runs` (`node_id`);
