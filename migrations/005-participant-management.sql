ALTER TABLE registrations ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE certificates ADD COLUMN last_error TEXT;
ALTER TABLE certificates ADD COLUMN attempted_at TEXT;
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,operation_id TEXT UNIQUE,event_id INTEGER,participant_token TEXT,action TEXT NOT NULL,label TEXT NOT NULL,details_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS audit_event ON audit_log(event_id,id DESC);
CREATE TABLE IF NOT EXISTS trash_batches(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('event','participant')),event_id INTEGER NOT NULL,label TEXT NOT NULL,deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,restored_at TEXT,restoring INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS trash_events(batch_id TEXT PRIMARY KEY,record_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trash_registrations(batch_id TEXT NOT NULL,registration_id INTEGER NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(batch_id,registration_id));
CREATE TABLE IF NOT EXISTS trash_certificates(batch_id TEXT NOT NULL,registration_id INTEGER NOT NULL,record_json TEXT NOT NULL,PRIMARY KEY(batch_id,registration_id));
CREATE TRIGGER IF NOT EXISTS audit_registration_created AFTER INSERT ON registrations
WHEN NOT EXISTS(SELECT 1 FROM trash_batches WHERE event_id=NEW.event_id AND restoring=1)
BEGIN INSERT INTO audit_log(event_id,participant_token,action,label,details_json) VALUES(NEW.event_id,NEW.token,CASE WHEN NEW.checked_in_at IS NULL THEN 'enrollment_created' ELSE 'presence_confirmed' END,NEW.name,json_object('company',NEW.company,'phone',NEW.phone,'source',NEW.source)); END;
CREATE TRIGGER IF NOT EXISTS audit_presence AFTER UPDATE OF checked_in_at ON registrations
WHEN OLD.checked_in_at IS NULL AND NEW.checked_in_at IS NOT NULL
BEGIN INSERT INTO audit_log(event_id,participant_token,action,label) VALUES(NEW.event_id,NEW.token,'presence_confirmed',NEW.name); END;
CREATE TRIGGER IF NOT EXISTS audit_event_created AFTER INSERT ON events
WHEN NOT EXISTS(SELECT 1 FROM trash_batches WHERE event_id=NEW.id AND restoring=1)
BEGIN INSERT INTO audit_log(event_id,action,label) VALUES(NEW.id,'event_created',NEW.name); END;
CREATE TRIGGER IF NOT EXISTS audit_event_updated AFTER UPDATE ON events
WHEN OLD.name IS NOT NEW.name OR OLD.date IS NOT NEW.date OR OLD.location IS NOT NEW.location OR OLD.start_time IS NOT NEW.start_time OR OLD.end_time IS NOT NEW.end_time OR OLD.description IS NOT NEW.description OR OLD.capacity IS NOT NEW.capacity OR OLD.registrations_open IS NOT NEW.registrations_open OR OLD.active IS NOT NEW.active OR OLD.finished IS NOT NEW.finished OR OLD.image_base64 IS NOT NEW.image_base64 OR OLD.certificate_template_id IS NOT NEW.certificate_template_id OR OLD.certificate_enabled IS NOT NEW.certificate_enabled OR OLD.certificate_hours IS NOT NEW.certificate_hours OR OLD.certificate_title IS NOT NEW.certificate_title OR OLD.certificate_location IS NOT NEW.certificate_location
BEGIN INSERT INTO audit_log(event_id,action,label,details_json) VALUES(NEW.id,'event_updated',NEW.name,json_object('before',json_object('name',OLD.name,'date',OLD.date,'location',OLD.location,'start_time',OLD.start_time,'end_time',OLD.end_time,'capacity',OLD.capacity,'active',OLD.active,'registrations_open',OLD.registrations_open,'finished',OLD.finished,'certificate_template',OLD.certificate_template_id,'certificate_enabled',OLD.certificate_enabled,'certificate_hours',OLD.certificate_hours,'certificate_title',OLD.certificate_title,'certificate_location',OLD.certificate_location),'after',json_object('name',NEW.name,'date',NEW.date,'location',NEW.location,'start_time',NEW.start_time,'end_time',NEW.end_time,'capacity',NEW.capacity,'active',NEW.active,'registrations_open',NEW.registrations_open,'finished',NEW.finished,'certificate_template',NEW.certificate_template_id,'certificate_enabled',NEW.certificate_enabled,'certificate_hours',NEW.certificate_hours,'certificate_title',NEW.certificate_title,'certificate_location',NEW.certificate_location),'image_changed',OLD.image_base64 IS NOT NEW.image_base64)); END;
CREATE TRIGGER IF NOT EXISTS audit_certificate_insert AFTER INSERT ON certificates WHEN NEW.pdf_base64 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM trash_batches b JOIN registrations r ON r.event_id=b.event_id WHERE r.id=NEW.registration_id AND b.restoring=1)
BEGIN INSERT INTO audit_log(event_id,participant_token,action,label) SELECT event_id,token,'certificate_issued',name FROM registrations WHERE id=NEW.registration_id; END;
CREATE TRIGGER IF NOT EXISTS audit_model_created AFTER INSERT ON certificate_templates
BEGIN INSERT INTO audit_log(action,label,details_json) VALUES('model_created',NEW.name,json_object('model_id',NEW.id,'revision',NEW.revision)); END;
CREATE TRIGGER IF NOT EXISTS audit_model_updated AFTER UPDATE ON certificate_templates WHEN OLD.revision IS NOT NEW.revision
BEGIN INSERT INTO audit_log(action,label,details_json) VALUES('model_updated',NEW.name,json_object('model_id',NEW.id,'revision_before',OLD.revision,'revision_after',NEW.revision)); END;
CREATE TRIGGER IF NOT EXISTS audit_certificate_update AFTER UPDATE OF pdf_base64 ON certificates WHEN OLD.pdf_base64 IS NULL AND NEW.pdf_base64 IS NOT NULL
BEGIN INSERT INTO audit_log(event_id,participant_token,action,label) SELECT event_id,token,'certificate_issued',name FROM registrations WHERE id=NEW.registration_id; END;
