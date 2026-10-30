ALTER TABLE events ADD COLUMN waitlist_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN reminder_template TEXT NOT NULL DEFAULT '';
ALTER TABLE registrations ADD COLUMN waitlisted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE registrations ADD COLUMN waitlisted_at TEXT;
ALTER TABLE registrations ADD COLUMN promoted_at TEXT;
ALTER TABLE registrations ADD COLUMN reminder_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE audit_log ADD COLUMN actor_name TEXT NOT NULL DEFAULT 'Sistema';
CREATE INDEX IF NOT EXISTS registration_waiting ON registrations(event_id,waitlisted,checked_in_at);
CREATE TABLE IF NOT EXISTS staff_users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_login TEXT);
CREATE TABLE IF NOT EXISTS staff_event_access(staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,event_id INTEGER NOT NULL,PRIMARY KEY(staff_id,event_id));
CREATE TABLE IF NOT EXISTS staff_sessions(id TEXT PRIMARY KEY,staff_id TEXT NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reminder_deliveries(id TEXT PRIMARY KEY,event_id INTEGER NOT NULL,participant_token TEXT NOT NULL,content_hash TEXT NOT NULL,marked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(event_id,participant_token,content_hash));
INSERT INTO settings(key,value) VALUES('reception_enabled','0'),('reminders_enabled','0'),('reminder_country','55') ON CONFLICT(key) DO NOTHING;
DROP TRIGGER IF EXISTS audit_registration_created;
CREATE TRIGGER audit_registration_created AFTER INSERT ON registrations
WHEN NOT EXISTS(SELECT 1 FROM trash_batches WHERE event_id=NEW.event_id AND restoring=1)
BEGIN INSERT INTO audit_log(event_id,participant_token,action,label,details_json) VALUES(NEW.event_id,NEW.token,CASE WHEN NEW.waitlisted=1 THEN 'waitlist_joined' WHEN NEW.checked_in_at IS NULL THEN 'enrollment_created' ELSE 'presence_confirmed' END,NEW.name,json_object('company',NEW.company,'phone',NEW.phone,'source',NEW.source)); END;
CREATE TRIGGER IF NOT EXISTS audit_event_options AFTER UPDATE OF waitlist_enabled,reminder_template ON events WHEN OLD.waitlist_enabled IS NOT NEW.waitlist_enabled OR OLD.reminder_template IS NOT NEW.reminder_template
BEGIN INSERT INTO audit_log(event_id,action,label,details_json) VALUES(NEW.id,'event_options_updated',NEW.name,json_object('waitlist_before',OLD.waitlist_enabled,'waitlist_after',NEW.waitlist_enabled,'reminder_changed',OLD.reminder_template IS NOT NEW.reminder_template)); END;
CREATE TRIGGER IF NOT EXISTS audit_waitlist_promoted AFTER UPDATE OF waitlisted ON registrations WHEN OLD.waitlisted=1 AND NEW.waitlisted=0
BEGIN INSERT INTO audit_log(event_id,participant_token,action,label,actor_name) VALUES(NEW.event_id,NEW.token,'waitlist_promoted',NEW.name,'Organização'); END;
