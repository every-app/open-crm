CREATE TABLE `agent_conversation_share` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_conversation_share_token_hash_unique` ON `agent_conversation_share` (`token_hash`);