-- Mail and calendar go through the Every App gateway's connections, which
-- hold the tokens: the CRM keeps none. This empties the tokens it kept and
-- its pending connects, and asks every member to connect again once. Data
-- only: the emptied columns and oauth_state are dropped a release later
-- (TODO.md), once no live code reads them.
UPDATE `mailbox_connection` SET `access_token` = NULL, `access_token_expires_at` = NULL, `refresh_token` = NULL, `status` = 'NEEDS_RECONNECT';
--> statement-breakpoint
UPDATE `mailbox_sync` SET `status` = 'NEEDS_RECONNECT', `last_error` = 'Mail now connects through Every App: connect again.', `next_sync_at` = NULL, `lease_until` = NULL;
--> statement-breakpoint
DELETE FROM `oauth_state`;
