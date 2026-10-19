CREATE INDEX `activity_company_idx` ON `activity` (`company_id`);--> statement-breakpoint
CREATE INDEX `activity_contact_idx` ON `activity` (`contact_id`);--> statement-breakpoint
CREATE INDEX `activity_deal_idx` ON `activity` (`deal_id`);--> statement-breakpoint
CREATE INDEX `calendar_event_company_idx` ON `calendar_event` (`company_id`);--> statement-breakpoint
CREATE INDEX `calendar_event_contact_idx` ON `calendar_event` (`contact_id`);--> statement-breakpoint
CREATE INDEX `company_organization_created_idx` ON `company` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_organization_company_archived_idx` ON `contact` (`organization_id`,`company_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `contact_organization_created_idx` ON `contact` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_company_idx` ON `contact` (`company_id`);--> statement-breakpoint
CREATE INDEX `deal_organization_company_archived_idx` ON `deal` (`organization_id`,`company_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `deal_organization_created_idx` ON `deal` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deal_company_idx` ON `deal` (`company_id`);--> statement-breakpoint
CREATE INDEX `email_thread_company_idx` ON `email_thread` (`company_id`);--> statement-breakpoint
CREATE INDEX `email_thread_contact_idx` ON `email_thread` (`contact_id`);--> statement-breakpoint
CREATE INDEX `form_submission_contact_idx` ON `form_submission` (`contact_id`);--> statement-breakpoint
CREATE INDEX `tracked_visitor_contact_idx` ON `tracked_visitor` (`contact_id`);