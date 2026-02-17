const path = require('path');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, '..', 'data.sqlite');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  alias TEXT,
  bio TEXT,
  picture_url TEXT,
  custom_picture_path TEXT,
  share_code TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_user_id INTEGER NOT NULL,
  author_user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('text', 'image', 'audio')),
  text_content TEXT,
  file_path TEXT,
  original_name TEXT,
  mime_type TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(target_user_id) REFERENCES users(id),
  FOREIGN KEY(author_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_share_code ON users(share_code);
CREATE INDEX IF NOT EXISTS idx_entries_target_user ON entries(target_user_id);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at);

CREATE TABLE IF NOT EXISTS dino_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_dino_scores_best_score ON dino_scores(best_score DESC);

CREATE TABLE IF NOT EXISTS allowed_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_allowed_emails_email ON allowed_emails(email);

CREATE TABLE IF NOT EXISTS access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  google_id TEXT,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_requests_email ON access_requests(email);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);
`);

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((row) => row.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing('users', 'alias', 'TEXT');
addColumnIfMissing('users', 'bio', 'TEXT');
addColumnIfMissing('users', 'custom_picture_path', 'TEXT');

function nowIso() {
  return new Date().toISOString();
}

function normalizeGooglePhotoUrl(url) {
  if (!url) return null;
  const clean = String(url).trim();
  if (!clean) return null;
  return clean.replace(/=s\d+-c$/, '=s256-c');
}

function getGoogleProfilePicture(profile) {
  const fromPhotos = profile.photos && profile.photos[0] ? profile.photos[0].value : null;
  const fromJson = profile._json && profile._json.picture ? profile._json.picture : null;
  return normalizeGooglePhotoUrl(fromPhotos || fromJson);
}

function getExistingUserByEmailOrGoogle(email, googleId) {
  if (googleId) {
    const byGoogle = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
    if (byGoogle) return byGoogle;
  }
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function createAccessRequest({ email, googleId, displayName, pictureUrl }) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO access_requests (email, google_id, display_name, picture_url, status, requested_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(email, googleId || null, displayName, pictureUrl || null, now);
  return db.prepare('SELECT * FROM access_requests WHERE id = last_insert_rowid()').get();
}

function getLatestPendingRequestByEmail(email) {
  return db.prepare(`
    SELECT *
    FROM access_requests
    WHERE email = ? AND status = 'pending'
    ORDER BY requested_at DESC
    LIMIT 1
  `).get(email);
}

function listAccessRequests(status = null) {
  if (status) {
    return db.prepare(`
      SELECT *
      FROM access_requests
      WHERE status = ?
      ORDER BY requested_at DESC
      LIMIT 300
    `).all(status);
  }
  return db.prepare(`
    SELECT *
    FROM access_requests
    ORDER BY requested_at DESC
    LIMIT 300
  `).all();
}

function getAccessRequestById(id) {
  return db.prepare('SELECT * FROM access_requests WHERE id = ?').get(id);
}

function updateAccessRequestStatus(id, status) {
  db.prepare(`
    UPDATE access_requests
    SET status = ?, reviewed_at = ?
    WHERE id = ?
  `).run(status, nowIso(), id);
  return getAccessRequestById(id);
}

function approveAccessRequest(id) {
  const req = getAccessRequestById(id);
  if (!req) return null;

  const cleanEmail = String(req.email || '').trim().toLowerCase();
  if (!cleanEmail) return null;

  let user = getExistingUserByEmailOrGoogle(cleanEmail, req.google_id);
  if (!user) {
    db.prepare(`
      INSERT INTO users (google_id, email, display_name, picture_url, share_code, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.google_id || null,
      cleanEmail,
      req.display_name || cleanEmail,
      req.picture_url || null,
      uuidv4(),
      nowIso(),
      nowIso()
    );
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
  }

  updateAccessRequestStatus(id, 'approved');
  ensureDefaultPostForUser(user.id);
  return user;
}

function rejectAccessRequest(id) {
  const req = getAccessRequestById(id);
  if (!req) return null;
  return updateAccessRequestStatus(id, 'rejected');
}

function upsertUserFromGoogle(profile) {
  const emailObj = profile.emails && profile.emails[0];
  if (!emailObj || !emailObj.value) {
    throw new Error('No email found from Google profile');
  }

  const email = emailObj.value.toLowerCase();
  const displayName = profile.displayName || email;
  const picture = getGoogleProfilePicture(profile);
  const googleId = profile.id;

  const existingByGoogleId = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
  if (existingByGoogleId) {
    db.prepare(`
      UPDATE users
      SET email = ?, display_name = ?, picture_url = ?, last_login_at = ?
      WHERE id = ?
    `).run(email, displayName, picture, nowIso(), existingByGoogleId.id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(existingByGoogleId.id);
    ensureDefaultPostForUser(user.id);
    return user;
  }

  const existingByEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (existingByEmail) {
    db.prepare(`
      UPDATE users
      SET google_id = ?, display_name = ?, picture_url = ?, last_login_at = ?
      WHERE id = ?
    `).run(googleId, displayName, picture, nowIso(), existingByEmail.id);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(existingByEmail.id);
    ensureDefaultPostForUser(user.id);
    return user;
  }

  const shareCode = uuidv4();
  db.prepare(`
    INSERT INTO users (google_id, email, display_name, picture_url, share_code, created_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(googleId, email, displayName, picture, shareCode, nowIso(), nowIso());

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  ensureDefaultPostForUser(user.id);
  return user;
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getOrCreateD25User() {
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get('d25@iima.ac.in');
  if (!user) {
    const now = nowIso();
    db.prepare(`
      INSERT INTO users (google_id, email, display_name, picture_url, share_code, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('system-d25', 'd25@iima.ac.in', 'D25', null, uuidv4(), now, now);
    user = db.prepare('SELECT * FROM users WHERE email = ?').get('d25@iima.ac.in');
  }
  return user;
}

function ensureDefaultPostForUser(targetUserId) {
  const d25 = getOrCreateD25User();
  const exists = db.prepare(`
    SELECT id
    FROM entries
    WHERE target_user_id = ?
      AND author_user_id = ?
      AND type = 'text'
      AND text_content = ?
    LIMIT 1
  `).get(targetUserId, d25.id, 'Siuuuu');

  if (!exists) {
    db.prepare(`
      INSERT INTO entries (target_user_id, author_user_id, type, text_content, created_at)
      VALUES (?, ?, 'text', ?, ?)
    `).run(targetUserId, d25.id, 'Siuuuu', nowIso());
  }
}

function seedDefaultPostForAllUsers() {
  const users = db.prepare('SELECT id FROM users').all();
  users.forEach((user) => {
    ensureDefaultPostForUser(user.id);
  });
}

function upsertDinoScore(userId, score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0) {
    return null;
  }

  const safeScore = Math.floor(numericScore);
  const existing = db.prepare('SELECT * FROM dino_scores WHERE user_id = ?').get(userId);

  if (!existing) {
    db.prepare(`
      INSERT INTO dino_scores (user_id, best_score, updated_at)
      VALUES (?, ?, ?)
    `).run(userId, safeScore, nowIso());
    return db.prepare('SELECT * FROM dino_scores WHERE user_id = ?').get(userId);
  }

  if (safeScore > existing.best_score) {
    db.prepare(`
      UPDATE dino_scores
      SET best_score = ?, updated_at = ?
      WHERE user_id = ?
    `).run(safeScore, nowIso(), userId);
  }

  return db.prepare('SELECT * FROM dino_scores WHERE user_id = ?').get(userId);
}

function getDinoLeaderboard(limit = 20) {
  return db.prepare(`
    SELECT u.display_name, u.alias, u.picture_url, u.custom_picture_path, ds.best_score, ds.updated_at
    FROM dino_scores ds
    JOIN users u ON u.id = ds.user_id
    ORDER BY ds.best_score DESC, ds.updated_at ASC
    LIMIT ?
  `).all(limit);
}

function isEmailAllowed(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return false;
  const row = db.prepare('SELECT id FROM allowed_emails WHERE lower(email) = lower(?)').get(clean);
  return Boolean(row);
}

function addAllowedEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  db.prepare('INSERT OR IGNORE INTO allowed_emails (email, created_at) VALUES (?, ?)').run(clean, nowIso());
  return db.prepare('SELECT * FROM allowed_emails WHERE lower(email) = lower(?)').get(clean);
}

function removeAllowedEmail(id) {
  db.prepare('DELETE FROM allowed_emails WHERE id = ?').run(id);
}

function listAllowedEmails() {
  return db.prepare('SELECT * FROM allowed_emails ORDER BY email ASC').all();
}

module.exports = {
  db,
  getUserById,
  getExistingUserByEmailOrGoogle,
  createAccessRequest,
  getLatestPendingRequestByEmail,
  listAccessRequests,
  getAccessRequestById,
  approveAccessRequest,
  rejectAccessRequest,
  upsertUserFromGoogle,
  ensureDefaultPostForUser,
  seedDefaultPostForAllUsers,
  upsertDinoScore,
  getDinoLeaderboard,
  isEmailAllowed,
  addAllowedEmail,
  removeAllowedEmail,
  listAllowedEmails
};
