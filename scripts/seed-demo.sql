-- The Bramblewood demo set, for local runs only: `pnpm db:seed:local`
-- (docs/development.md). Bramblewood is a fictional coffee-gear brand; every
-- name, domain and email here is made up (the domains end in .example).
--
-- It fills the organization `pnpm dev` signs in as (`everyapp dev`'s stub
-- identity: organization `dev-org`, user `dev-user`) with companies and
-- contacts, two lists with stages ("Backlink outreach" and "Networking"),
-- one deal (so deals are on), notes, a task and stage changes. Dates are
-- relative to now, so some entries are Due and the task is overdue.
--
-- Running it again resets the demo records (ids starting `demo_`) and leaves
-- everything else as it is.

-- The organization, user and membership the app mirrors on its first
-- request (src/server/auth/delegated-organization.ts), in case it hasn't run.
INSERT OR IGNORE INTO organization (id, name, slug, created_at)
VALUES ('dev-org', 'Organization dev-org', 'everyapp-6465762d6f7267', cast(unixepoch('subsecond') * 1000 as integer));

INSERT OR IGNORE INTO "user" (id, name, email, email_verified)
VALUES ('dev-user', 'dev', 'dev@everyapp.localhost', 1);

INSERT OR IGNORE INTO member (id, organization_id, user_id, role, created_at)
VALUES ('demo_member', 'dev-org', 'dev-user', 'owner', cast(unixepoch('subsecond') * 1000 as integer));

-- The workspace: Bramblewood, onboarded, deals on.
INSERT INTO workspace (organization_id, name, website, onboarded_at, deals_enabled)
VALUES ('dev-org', 'Bramblewood', 'bramblewood.example', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
ON CONFLICT (organization_id) DO UPDATE SET
  name = excluded.name,
  website = excluded.website,
  onboarded_at = coalesce(workspace.onboarded_at, excluded.onboarded_at),
  deals_enabled = 1;

-- Start over: deleting the demo companies, contacts and lists takes their
-- deals, list entries and timelines with them (ON DELETE cascade).
DELETE FROM record_list WHERE organization_id = 'dev-org' AND id LIKE 'demo_%';
DELETE FROM contact WHERE organization_id = 'dev-org' AND id LIKE 'demo_%';
DELETE FROM company WHERE organization_id = 'dev-org' AND id LIKE 'demo_%';

-- Companies: the publications Bramblewood pitches, and two partners.
INSERT INTO company (id, organization_id, name, domain, website, industry, description, owner_id, last_activity_at, created_at, updated_at) VALUES
  ('demo_co_dailypour', 'dev-org', 'The Daily Pour', 'dailypour.example', 'https://dailypour.example', 'Media', 'Daily coffee news and brewing guides.', 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')),
  ('demo_co_tamped', 'dev-org', 'Tamped Magazine', 'tamped.example', 'https://tamped.example', 'Media', 'A print magazine about coffee culture.', 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-45 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days')),
  ('demo_co_filterreview', 'dev-org', 'Filter Coffee Review', 'filtercoffeereview.example', 'https://filtercoffeereview.example', 'Media', 'Trade magazine for roasters.', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')),
  ('demo_co_grinddaily', 'dev-org', 'Grind Daily News', 'grinddaily.example', 'https://grinddaily.example', 'Media', 'Coffee news and culture.', 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days')),
  ('demo_co_slowpour', 'dev-org', 'Slow Pour Magazine', 'slowpour.example', 'https://slowpour.example', 'Media', 'Coffee industry news and education.', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days')),
  ('demo_co_kettlenotes', 'dev-org', 'Kettle Notes', 'kettlenotes.example', 'https://kettlenotes.example', 'Media', 'Reviews of home brewing gear.', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 days')),
  ('demo_co_hollowmere', 'dev-org', 'Hollowmere Roasters', 'hollowmere.example', 'https://hollowmere.example', 'Food & beverage', 'Specialty roaster, wholesale and cafés.', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-70 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-120 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-70 days')),
  ('demo_co_canister', 'dev-org', 'Canister & Loop', 'canisterloop.example', 'https://canisterloop.example', 'Retail', 'Refillable coffee supplies.', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 days'));

-- Contacts.
INSERT INTO contact (id, organization_id, first_name, last_name, email, title, company_id, owner_id, last_activity_at, created_at, updated_at) VALUES
  ('demo_ct_maya', 'dev-org', 'Maya', 'Chen', 'maya@dailypour.example', 'Editor', 'demo_co_dailypour', 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')),
  ('demo_ct_jonas', 'dev-org', 'Jonas', 'Weber', 'jonas@hollowmere.example', 'Head roaster', 'demo_co_hollowmere', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-70 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-120 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-70 days')),
  ('demo_ct_priya', 'dev-org', 'Priya', 'Nair', 'priya@canisterloop.example', 'Partnerships lead', 'demo_co_canister', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 days')),
  ('demo_ct_lena', 'dev-org', 'Lena', 'Ross', 'lena@tamped.example', 'Features editor', 'demo_co_tamped', 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-45 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days')),
  ('demo_ct_diego', 'dev-org', 'Diego', 'Santos', 'diego@santosbrews.example', 'YouTube creator', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 days'));

-- Each company's primary contact.
UPDATE company SET primary_contact_id = 'demo_ct_maya' WHERE organization_id = 'dev-org' AND id = 'demo_co_dailypour';
UPDATE company SET primary_contact_id = 'demo_ct_lena' WHERE organization_id = 'dev-org' AND id = 'demo_co_tamped';
UPDATE company SET primary_contact_id = 'demo_ct_jonas' WHERE organization_id = 'dev-org' AND id = 'demo_co_hollowmere';
UPDATE company SET primary_contact_id = 'demo_ct_priya' WHERE organization_id = 'dev-org' AND id = 'demo_co_canister';

-- "Backlink outreach": publications, the Outreach stages, Due after 14 quiet days.
INSERT INTO record_list (id, organization_id, entity, name, color, description, follow_up_days, created_by_id, created_at, updated_at)
VALUES ('demo_list_outreach', 'dev-org', 'COMPANY', 'Backlink outreach', 'blue', 'Publications we pitch for links to the brewing guides.', 14, 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'));

INSERT INTO list_stage (id, organization_id, list_id, name, kind, position) VALUES
  ('demo_st_out_tocontact', 'dev-org', 'demo_list_outreach', 'To contact', 'OPEN', 0),
  ('demo_st_out_contacted', 'dev-org', 'demo_list_outreach', 'Contacted', 'OPEN', 1),
  ('demo_st_out_replied', 'dev-org', 'demo_list_outreach', 'Replied', 'OPEN', 2),
  ('demo_st_out_done', 'dev-org', 'demo_list_outreach', 'Done', 'DONE', 3),
  ('demo_st_out_notinterested', 'dev-org', 'demo_list_outreach', 'Not interested', 'DROPPED', 4);

-- Grind Daily News was contacted 20 days ago and hasn't answered: Due.
INSERT INTO list_entry (id, organization_id, list_id, company_id, stage_id, stage_changed_at, added_by_id, added_at) VALUES
  ('demo_le_out_roastmag', 'dev-org', 'demo_list_outreach', 'demo_co_filterreview', 'demo_st_out_tocontact', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days')),
  ('demo_le_out_kettlenotes', 'dev-org', 'demo_list_outreach', 'demo_co_kettlenotes', 'demo_st_out_tocontact', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days')),
  ('demo_le_out_grinddaily', 'dev-org', 'demo_list_outreach', 'demo_co_grinddaily', 'demo_st_out_contacted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')),
  ('demo_le_out_slowpour', 'dev-org', 'demo_list_outreach', 'demo_co_slowpour', 'demo_st_out_contacted', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')),
  ('demo_le_out_tamped', 'dev-org', 'demo_list_outreach', 'demo_co_tamped', 'demo_st_out_replied', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days')),
  ('demo_le_out_dailypour', 'dev-org', 'demo_list_outreach', 'demo_co_dailypour', 'demo_st_out_done', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days'));

-- "Networking": people, the Networking stages, Due after 60 quiet days.
INSERT INTO record_list (id, organization_id, entity, name, color, description, follow_up_days, created_by_id, created_at, updated_at)
VALUES ('demo_list_networking', 'dev-org', 'CONTACT', 'Networking', 'green', 'People in coffee worth keeping in touch with.', 60, 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'));

INSERT INTO list_stage (id, organization_id, list_id, name, kind, position) VALUES
  ('demo_st_net_tomeet', 'dev-org', 'demo_list_networking', 'To meet', 'OPEN', 0),
  ('demo_st_net_met', 'dev-org', 'demo_list_networking', 'Met', 'OPEN', 1),
  ('demo_st_net_keepintouch', 'dev-org', 'demo_list_networking', 'Keep in touch', 'OPEN', 2),
  ('demo_st_net_dormant', 'dev-org', 'demo_list_networking', 'Dormant', 'DROPPED', 3);

-- Jonas was last heard from 70 days ago: Due.
INSERT INTO list_entry (id, organization_id, list_id, contact_id, stage_id, stage_changed_at, added_by_id, added_at) VALUES
  ('demo_le_net_maya', 'dev-org', 'demo_list_networking', 'demo_ct_maya', 'demo_st_net_keepintouch', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-38 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-60 days')),
  ('demo_le_net_jonas', 'dev-org', 'demo_list_networking', 'demo_ct_jonas', 'demo_st_net_met', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-70 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')),
  ('demo_le_net_priya', 'dev-org', 'demo_list_networking', 'demo_ct_priya', 'demo_st_net_tomeet', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-15 days')),
  ('demo_le_net_diego', 'dev-org', 'demo_list_networking', 'demo_ct_diego', 'demo_st_net_met', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days'));

-- A plain list (no stages), a group like a tag: Maya is in two lists.
INSERT INTO record_list (id, organization_id, entity, name, color, description, follow_up_days, created_by_id, created_at, updated_at)
VALUES ('demo_list_podcast', 'dev-org', 'CONTACT', 'Podcast guests', 'purple', 'People to invite on the Bramblewood brew show.', NULL, 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'));

INSERT INTO list_entry (id, organization_id, list_id, contact_id, stage_id, stage_changed_at, added_by_id, added_at) VALUES
  ('demo_le_pod_maya', 'dev-org', 'demo_list_podcast', 'demo_ct_maya', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days')),
  ('demo_le_pod_diego', 'dev-org', 'demo_list_podcast', 'demo_ct_diego', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'), 'dev-user', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'));

-- One deal, with Maya on it.
INSERT INTO deal (id, organization_id, name, description, company_id, owner_id, stage, stage_changed_at, amount, currency, expected_close_date, base_amount, base_currency, fx_rate, fx_rate_at, last_activity_at, created_at, updated_at)
VALUES ('demo_deal_guide', 'dev-org', 'Sponsored brewing guide', 'A sponsored pour-over guide on The Daily Pour, featuring the Bramblewood kettle.', 'demo_co_dailypour', 'dev-user', 'QUALIFIED_TO_BUY', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), 2400, 'USD', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+21 days'), 2400, 'USD', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'));

INSERT INTO deal_contact (deal_id, contact_id, organization_id, role)
VALUES ('demo_deal_guide', 'demo_ct_maya', 'dev-org', 'Editor');

-- Timelines: notes, a call, an overdue task, and stage changes in the lists.
INSERT INTO activity (id, organization_id, type, subject, body, occurred_at, due_at, company_id, contact_id, deal_id, list_entry_id, created_by_id, meta, created_at, updated_at) VALUES
  ('demo_act_maya_met', 'dev-org', 'NOTE', NULL, 'Met Maya at the Brew Expo. She''s planning a gear issue for spring and liked the kettle.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days'), NULL, 'demo_co_dailypour', 'demo_ct_maya', NULL, NULL, 'dev-user', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 days')),
  ('demo_act_maya_stage', 'dev-org', 'STAGE_CHANGE', 'Stage changed', 'Coffee after the expo; she wants to hear about the spring launch.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-38 days'), NULL, NULL, 'demo_ct_maya', NULL, 'demo_le_net_maya', 'dev-user', json_object('list', 'Networking', 'listId', 'demo_list_networking', 'from', 'Met', 'to', 'Keep in touch'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-38 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-38 days')),
  ('demo_act_dailypour_done', 'dev-org', 'STAGE_CHANGE', 'Stage changed', 'The kettle review is live, with a link to the pour-over guide.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days'), NULL, 'demo_co_dailypour', NULL, NULL, 'demo_le_out_dailypour', 'dev-user', json_object('list', 'Backlink outreach', 'listId', 'demo_list_outreach', 'from', 'Replied', 'to', 'Done'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days')),
  ('demo_act_guide_note', 'dev-org', 'NOTE', NULL, 'Maya wants a 2,000-word guide with photos. Budget approved on their side.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), NULL, 'demo_co_dailypour', 'demo_ct_maya', 'demo_deal_guide', NULL, 'dev-user', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days')),
  ('demo_act_tamped_stage', 'dev-org', 'STAGE_CHANGE', 'Stage changed', 'Lena replied: open to a piece on grinder burrs.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), NULL, 'demo_co_tamped', NULL, NULL, 'demo_le_out_tamped', 'dev-user', json_object('list', 'Backlink outreach', 'listId', 'demo_list_outreach', 'from', 'Contacted', 'to', 'Replied'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days')),
  ('demo_act_tamped_task', 'dev-org', 'TASK', 'Send Lena the grinder draft', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 'demo_co_tamped', 'demo_ct_lena', NULL, NULL, 'dev-user', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days')),
  ('demo_act_grinddaily_pitch', 'dev-org', 'NOTE', NULL, 'Pitched the home grinder roundup. No answer yet.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'), NULL, 'demo_co_grinddaily', NULL, NULL, NULL, 'dev-user', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 days')),
  ('demo_act_pdg_stage', 'dev-org', 'STAGE_CHANGE', 'Stage changed', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), NULL, 'demo_co_slowpour', NULL, NULL, 'demo_le_out_slowpour', 'dev-user', json_object('list', 'Backlink outreach', 'listId', 'demo_list_outreach', 'from', 'To contact', 'to', 'Contacted'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days')),
  ('demo_act_jonas_call', 'dev-org', 'CALL', NULL, 'Talked about a co-branded filter blend. Check back after harvest.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-70 days'), NULL, 'demo_co_hollowmere', 'demo_ct_jonas', NULL, NULL, 'dev-user', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-70 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-70 days')),
  ('demo_act_diego_note', 'dev-org', 'NOTE', NULL, 'Diego reviewed the kettle on his channel; 40k views in the first week.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 days'), NULL, NULL, 'demo_ct_diego', NULL, NULL, 'dev-user', NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 days'));
