import { createDatabase } from "./client.js";

const DDL = `
CREATE TABLE IF NOT EXISTS referrers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS referrers_code_unique ON referrers (code);
CREATE INDEX IF NOT EXISTS referrers_active_idx ON referrers (active);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  referrer_phone TEXT,
  referrer_id INTEGER REFERENCES referrers(id),
  consent_version INTEGER NOT NULL,
  consent_timestamp TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_unique ON customers (email);
CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_unique ON customers (phone);
CREATE INDEX IF NOT EXISTS customers_referrer_phone_idx ON customers (referrer_phone);

CREATE TABLE IF NOT EXISTS products (
  reference TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  size TEXT NOT NULL,
  price REAL NOT NULL,
  benefits TEXT NOT NULL,
  dosage TEXT NOT NULL,
  ingredients TEXT NOT NULL,
  disclaimer TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  product_reference TEXT NOT NULL REFERENCES products(reference),
  qty INTEGER NOT NULL DEFAULT 1,
  purchased_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_customer_id_idx ON purchases (customer_id);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS conversations_customer_id_idx ON conversations (customer_id);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON messages (conversation_id);

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  symptom TEXT NOT NULL,
  product_references TEXT NOT NULL,
  rationale TEXT NOT NULL,
  consent_version INTEGER NOT NULL,
  guard_blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS recommendations_customer_id_idx ON recommendations (customer_id);
CREATE INDEX IF NOT EXISTS recommendations_created_at_idx ON recommendations (created_at);

CREATE TABLE IF NOT EXISTS guidance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  product_references TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS guidance_enabled_idx ON guidance (enabled);

CREATE TABLE IF NOT EXISTS assessment_symptoms (
  id INTEGER PRIMARY KEY,
  name_es TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assessment_symptoms_name_idx ON assessment_symptoms (name_es);

CREATE TABLE IF NOT EXISTS assessment_nutrients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assessment_nutrients_type_idx ON assessment_nutrients (type);

CREATE TABLE IF NOT EXISTS assessment_symptom_nutrients (
  symptom_id INTEGER NOT NULL REFERENCES assessment_symptoms(id),
  nutrient_id TEXT NOT NULL REFERENCES assessment_nutrients(id),
  weight INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS assessment_sn_symptom_idx ON assessment_symptom_nutrients (symptom_id);
CREATE INDEX IF NOT EXISTS assessment_sn_nutrient_idx ON assessment_symptom_nutrients (nutrient_id);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  patient_name TEXT NOT NULL,
  patient_sex TEXT NOT NULL,
  patient_age INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  referrer_id INTEGER REFERENCES referrers(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS assessments_status_idx ON assessments (status);
CREATE INDEX IF NOT EXISTS assessments_created_at_idx ON assessments (created_at);

CREATE TABLE IF NOT EXISTS assessment_responses (
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  symptom_id INTEGER NOT NULL REFERENCES assessment_symptoms(id),
  answered INTEGER NOT NULL,
  PRIMARY KEY (assessment_id, symptom_id)
);

CREATE TABLE IF NOT EXISTS assessment_results (
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  nutrient_id TEXT NOT NULL REFERENCES assessment_nutrients(id),
  score REAL NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (assessment_id, nutrient_id)
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  speaker TEXT NOT NULL,
  youtube_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_s INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  license_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS videos_youtube_id_unique ON videos (youtube_id);

CREATE TABLE IF NOT EXISTS video_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  condition TEXT,
  symptom_id INTEGER REFERENCES assessment_symptoms(id),
  start_s INTEGER NOT NULL,
  end_s INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  clip_youtube_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS video_segments_enabled_idx ON video_segments (enabled);
CREATE INDEX IF NOT EXISTS video_segments_condition_idx ON video_segments (condition);
`;

/**
 * Creates the SQLite tables. Idempotent (`IF NOT EXISTS`), never drops or
 * alters existing tables — matches the design's "No migration" dev strategy.
 * The DDL mirrors the portable Drizzle schema in src/db/schema.ts.
 */
export async function migrate(db: ReturnType<typeof createDatabase>): Promise<void> {
  // Use execMany for multiple statements in better-sqlite3
  const statements = DDL.split(';').filter(s => s.trim());
  for (const stmt of statements) {
    db.$client.exec(stmt + ';');
  }

  // ALTER TABLE for existing databases — add referrer_id columns if missing
  const alterStatements = [
    `ALTER TABLE customers ADD COLUMN referrer_id INTEGER REFERENCES referrers(id)`,
    `ALTER TABLE assessments ADD COLUMN referrer_id INTEGER REFERENCES referrers(id)`,
  ];
  for (const stmt of alterStatements) {
    try {
      db.$client.exec(stmt);
    } catch {
      // Column already exists — ignore
    }
  }
}

/** Convenience: create the default dev database at ./data/dev.sqlite. */
export async function migrateDefault(): Promise<void> {
  const db = createDatabase(process.env.SQLITE_PATH ?? "./data/dev.sqlite");
  await migrate(db);
  db.$client.close();
}

// Allow `tsx src/db/migrate.ts` to run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateDefault()
    .then(() => console.log("migrate: tables ready"))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}