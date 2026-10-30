CREATE TABLE IF NOT EXISTS certificate_templates(id TEXT PRIMARY KEY,name TEXT NOT NULL,content_type TEXT NOT NULL,asset_base64 TEXT NOT NULL,width REAL NOT NULL,height REAL NOT NULL,config_json TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
ALTER TABLE events ADD COLUMN certificate_template_id TEXT;
ALTER TABLE events ADD COLUMN certificate_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN certificate_hours TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN certificate_title TEXT NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN certificate_location TEXT NOT NULL DEFAULT '';
ALTER TABLE certificates ADD COLUMN pdf_base64 TEXT;
ALTER TABLE certificates ADD COLUMN code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS certificate_code_unique ON certificates(code) WHERE code IS NOT NULL;
