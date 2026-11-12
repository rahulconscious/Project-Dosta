PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, salt TEXT NOT NULL, hash TEXT NOT NULL, ts INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, exp INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profiles(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, intensity INTEGER DEFAULT 1, traits TEXT DEFAULT '', lang TEXT DEFAULT 'en', ts INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, ts INTEGER DEFAULT (unixepoch()));
-- items holds per-profile memories, voice-diary entries and daily goals
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN('memories','diary','goals')), text TEXT NOT NULL, done INTEGER DEFAULT 0, ts INTEGER DEFAULT (unixepoch()));
CREATE INDEX IF NOT EXISTS i_items ON items(profile_id,kind);
CREATE INDEX IF NOT EXISTS i_msgs ON messages(profile_id,id);
