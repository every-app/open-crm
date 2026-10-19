CREATE TABLE `paid_session` (
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`slot` integer NOT NULL,
	`session_id` text NOT NULL,
	`leased_until` text NOT NULL,
	PRIMARY KEY(`organization_id`, `kind`, `slot`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
