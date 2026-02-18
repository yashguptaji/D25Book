require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const flash = require('connect-flash');
const morgan = require('morgan');
const multer = require('multer');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const {
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
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
const allowDevLogin = process.env.ALLOW_DEV_LOGIN === 'true';
const adminLoginId = process.env.ADMIN_LOGIN_ID || '0000';
const adminLoginPass = process.env.ADMIN_LOGIN_PASS || '0000';

seedDefaultPostForAllUsers();

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-_]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isImage = file.mimetype.startsWith('image/');
    const isAudio = file.mimetype.startsWith('audio/');
    const isVideo = file.mimetype.startsWith('video/');

    if (isVideo) {
      return cb(new Error('Video uploads are not allowed.'));
    }

    if (!isImage && !isAudio) {
      return cb(new Error('Only image or audio files are allowed.'));
    }

    cb(null, true);
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'replace-this-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
  })
);

app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  try {
    const user = getUserById(id);
    done(null, user || false);
  } catch (error) {
    done(error);
  }
});

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const callbackURL = process.env.GOOGLE_CALLBACK_URL || `${baseUrl}/auth/google/callback`;

function isAllowedIimaEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith('@iima.ac.in');
}

function getDisplayName(user) {
  if (!user) return '';
  const alias = String(user.alias || '').trim();
  return alias || user.display_name;
}

function getAvatarUrl(user) {
  if (!user) return '/default-avatar.svg';
  if (user.custom_picture_path) return `/${user.custom_picture_path}`;
  if (user.picture_url) return user.picture_url;
  return '/default-avatar.svg';
}

function getGooglePicture(profile) {
  const fromPhotos = profile.photos && profile.photos[0] ? profile.photos[0].value : '';
  const fromJson = profile._json && profile._json.picture ? profile._json.picture : '';
  const raw = String(fromPhotos || fromJson || '').trim();
  if (!raw) return null;
  return raw.replace(/=s\d+-c$/, '=s256-c');
}

if (googleClientId && googleClientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL
      },
      (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails && profile.emails[0] ? profile.emails[0].value.toLowerCase() : '';
          if (!isAllowedIimaEmail(email)) {
            return done(null, false, { message: 'Unauthorized: only @iima.ac.in email IDs are allowed.' });
          }

          const existing = getExistingUserByEmailOrGoogle(email, profile.id);
          if (existing) {
            const user = upsertUserFromGoogle(profile);
            return done(null, user);
          }

          const pending = getLatestPendingRequestByEmail(email);
          if (pending) {
            return done(null, false, { message: 'Access request already pending approval.' });
          }

          const displayName = profile.displayName || email;
          const picture = getGooglePicture(profile);
          createAccessRequest({
            email,
            googleId: profile.id,
            displayName,
            pictureUrl: picture
          });
          return done(null, false, { message: 'Access request submitted. Please retry after approval.' });
        } catch (error) {
          return done(error);
        }
      }
    )
  );
}

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.redirect('/');
  }
  return next();
}

function requirePortalAccess(req, res, next) {
  if (req.isAuthenticated() || (req.session && req.session.isAdmin)) {
    return next();
  }
  return res.redirect('/');
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    req.flash('error', 'Login required.');
    return res.redirect('/');
  }
  return next();
}

app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.displayName = getDisplayName(req.user);
  res.locals.avatarUrl = getAvatarUrl(req.user);
  res.locals.isAdmin = Boolean(req.session && req.session.isAdmin);
  res.locals.error = req.flash('error');
  res.locals.success = req.flash('success');
  next();
});

app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/home');
  }
  if (req.session && req.session.isAdmin) {
    return res.redirect('/admin');
  }

  return res.render('login', {
    oauthReady: Boolean(googleClientId && googleClientSecret),
    allowDevLogin,
    adminLoginEnabled: true
  });
});

app.post('/admin/login', (req, res) => {
  const loginId = String(req.body.login_id || '').trim();
  const loginPass = String(req.body.login_pass || '').trim();

  if (loginId !== adminLoginId || loginPass !== adminLoginPass) {
    req.flash('error', 'Invalid login credentials.');
    return res.redirect('/');
  }

  req.session.isAdmin = true;
  req.flash('success', 'Login successful.');
  return res.redirect('/admin');
});

app.post('/admin/logout', (req, res) => {
  if (req.session) {
    req.session.isAdmin = false;
  }
  req.flash('success', 'Logged out.');
  return res.redirect('/');
});
app.get('/admin/logout', (req, res) => {
  if (req.session) {
    req.session.isAdmin = false;
  }
  req.flash('success', 'Logged out.');
  return res.redirect('/');
});
app.get('/auth/google', (req, res, next) => {
  if (!googleClientId || !googleClientSecret) {
    req.flash('error', 'Google OAuth is not configured on this server.');
    return res.redirect('/');
  }

  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    hd: 'iima.ac.in',
    prompt: 'select_account'
  })(req, res, next);
});

app.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/',
    failureFlash: true
  }),
  (req, res) => res.redirect('/home')
);

app.post('/auth/dev', (req, res) => {
  if (!allowDevLogin) {
    req.flash('error', 'Dev login is disabled.');
    return res.redirect('/');
  }

  const email = String(req.body.email || '').trim().toLowerCase();
  const displayName = String(req.body.display_name || '').trim() || email;

  if (!isAllowedIimaEmail(email)) {
    req.flash('error', 'Unauthorized: only @iima.ac.in email IDs are allowed.');
    return res.redirect('/');
  }
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    db.prepare(`
      INSERT INTO users (google_id, email, display_name, picture_url, share_code, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      `dev-${email}`,
      email,
      displayName,
      null,
      uuidv4(),
      new Date().toISOString(),
      new Date().toISOString()
    );
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  } else {
    db.prepare('UPDATE users SET display_name = ?, last_login_at = ? WHERE id = ?')
      .run(displayName, new Date().toISOString(), user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  req.login(user, (error) => {
    if (error) {
      req.flash('error', 'Could not create dev session.');
      return res.redirect('/');
    }
    ensureDefaultPostForUser(user.id);
    return res.redirect('/home');
  });
});

app.post('/logout', requireAuth, (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    req.session.destroy(() => {
      res.redirect('/');
    });
    return null;
  });
});

app.get('/home', requireAuth, (_req, res) => res.redirect('/profile'));

app.get('/people', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  const people = db.prepare(`
    SELECT id, display_name, alias, email, share_code, picture_url, custom_picture_path, bio
    FROM users
    WHERE id != ?
      AND (display_name LIKE ? OR alias LIKE ? OR email LIKE ?)
    ORDER BY COALESCE(alias, display_name) ASC
    LIMIT 300
  `).all(req.user.id, `%${q}%`, `%${q}%`, `%${q}%`);

  return res.render('people', { q, people });
});

app.get('/write/:shareCode', requireAuth, (req, res) => {
  const target = db.prepare('SELECT id, display_name, alias, email, share_code FROM users WHERE share_code = ?').get(req.params.shareCode);

  if (!target) {
    req.flash('error', 'User page not found.');
    return res.redirect('/people');
  }

  return res.render('write', { target });
});

app.post('/write/:shareCode', requireAuth, upload.single('media'), (req, res, next) => {
  try {
    const target = db.prepare('SELECT id, display_name, alias, share_code FROM users WHERE share_code = ?').get(req.params.shareCode);

    if (!target) {
      req.flash('error', 'User page not found.');
      return res.redirect('/people');
    }

    const textContent = (req.body.text_content || '').trim();
    const file = req.file;

    if (!textContent && !file) {
      req.flash('error', 'Please add text or upload an image/audio file.');
      return res.redirect(`/write/${target.share_code}`);
    }

    if (textContent) {
      db.prepare(`
        INSERT INTO entries (target_user_id, author_user_id, type, text_content, created_at)
        VALUES (?, ?, 'text', ?, ?)
      `).run(target.id, req.user.id, textContent, new Date().toISOString());
    }

    if (file) {
      const fileType = file.mimetype.startsWith('audio/') ? 'audio' : 'image';
      const relativePath = `uploads/${file.filename}`;

      db.prepare(`
        INSERT INTO entries (target_user_id, author_user_id, type, file_path, original_name, mime_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        target.id,
        req.user.id,
        fileType,
        relativePath,
        file.originalname,
        file.mimetype,
        new Date().toISOString()
      );
    }

    req.flash('success', `Your message was posted to ${getDisplayName(target)}'s page.`);
    return res.redirect(`/write/${target.share_code}`);
  } catch (error) {
    return next(error);
  }
});

app.get('/stats', requireAuth, (req, res) => {
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM entries) AS total_entries,
      (SELECT COUNT(*) FROM entries WHERE type = 'text') AS text_entries,
      (SELECT COUNT(*) FROM entries WHERE type = 'image') AS image_entries,
      (SELECT COUNT(*) FROM entries WHERE type = 'audio') AS audio_entries
  `).get();

  const topPages = db.prepare(`
    SELECT COALESCE(u.alias, u.display_name) AS display_name, u.email, COUNT(e.id) AS entry_count
    FROM users u
    LEFT JOIN entries e ON e.target_user_id = u.id
    GROUP BY u.id
    ORDER BY entry_count DESC, COALESCE(u.alias, u.display_name) ASC
    LIMIT 10
  `).all();

  const recentActivity = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
    FROM entries
    GROUP BY day
    ORDER BY day DESC
    LIMIT 14
  `).all();

  return res.render('stats', {
    totals,
    topPages,
    recentActivity
  });
});

app.get('/admin', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim();
  const requestStatus = 'pending';
  const users = q
    ? db.prepare(`
      SELECT id, email, display_name, alias, bio, share_code, last_login_at, created_at
      FROM users
      WHERE email LIKE ? OR display_name LIKE ? OR alias LIKE ?
      ORDER BY created_at DESC
      LIMIT 200
    `).all(`%${q}%`, `%${q}%`, `%${q}%`)
    : db.prepare(`
      SELECT id, email, display_name, alias, bio, share_code, last_login_at, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 200
    `).all();

  const allowedEmails = listAllowedEmails();
  const accessRequests = listAccessRequests(requestStatus === 'all' ? null : requestStatus);
  const metrics = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM allowed_emails) AS total_allowed_emails,
      (SELECT COUNT(*) FROM access_requests WHERE status = 'pending') AS pending_requests,
      (SELECT COUNT(*) FROM access_requests WHERE status = 'approved') AS approved_requests,
      (SELECT COUNT(*) FROM access_requests WHERE status = 'rejected') AS rejected_requests,
      (SELECT COUNT(*) FROM entries) AS total_posts,
      (SELECT COUNT(*) FROM entries WHERE type = 'text') AS text_posts,
      (SELECT COUNT(*) FROM entries WHERE type = 'image') AS image_posts,
      (SELECT COUNT(*) FROM entries WHERE type = 'audio') AS audio_posts,
      (SELECT COUNT(*) FROM users WHERE datetime(last_login_at) >= datetime('now', '-7 day')) AS active_users_7d
  `).get();

  return res.render('admin', { users, allowedEmails, accessRequests, metrics, q, requestStatus });
});

app.get('/admin/requests/:id', requireAdmin, (req, res) => {
  const request = getAccessRequestById(req.params.id);
  if (!request) {
    req.flash('error', 'Request not found.');
    return res.redirect('/admin');
  }
  const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(request.email);
  return res.render('admin-request', { request, existingUser });
});

app.post('/admin/requests/:id/approve', requireAdmin, (req, res) => {
  const user = approveAccessRequest(req.params.id);
  if (!user) {
    req.flash('error', 'Could not approve request.');
    return res.redirect('/admin');
  }

  req.flash('success', `Approved and added ${user.email} to current users.`);
  return res.redirect('/admin');
});

app.post('/admin/requests/:id/reject', requireAdmin, (req, res) => {
  const row = rejectAccessRequest(req.params.id);
  if (!row) {
    req.flash('error', 'Could not reject request.');
    return res.redirect('/admin');
  }
  req.flash('success', 'Request rejected. User can apply again.');
  return res.redirect('/admin');
});

app.get('/admin/metrics', requireAdmin, (req, res) => {
  const dailyPosts = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
    FROM entries
    GROUP BY day
    ORDER BY day DESC
    LIMIT 30
  `).all();

  const dailySignups = db.prepare(`
    SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
    FROM users
    GROUP BY day
    ORDER BY day DESC
    LIMIT 30
  `).all();

  const dailyLogins = db.prepare(`
    SELECT substr(last_login_at, 1, 10) AS day, COUNT(*) AS count
    FROM users
    GROUP BY day
    ORDER BY day DESC
    LIMIT 30
  `).all();

  const core = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM allowed_emails) AS total_allowed,
      (SELECT COUNT(*) FROM entries) AS total_posts,
      (SELECT COUNT(*) FROM entries WHERE type = 'text') AS total_text,
      (SELECT COUNT(*) FROM entries WHERE type = 'image') AS total_image,
      (SELECT COUNT(*) FROM entries WHERE type = 'audio') AS total_audio,
      (SELECT COUNT(*) FROM users WHERE datetime(last_login_at) >= datetime('now', '-7 day')) AS users_active_7d,
      (SELECT COUNT(*) FROM users WHERE datetime(last_login_at) >= datetime('now', '-1 day')) AS users_active_1d
  `).get();

  const postsPerUser = core.total_users ? (core.total_posts / core.total_users) : 0;
  const allowlistCoverage = core.total_allowed ? (core.total_users / core.total_allowed) * 100 : 0;
  const weeklyActiveRate = core.total_users ? (core.users_active_7d / core.total_users) * 100 : 0;

  const topContributors = db.prepare(`
    SELECT COALESCE(au.alias, au.display_name) AS name, COUNT(e.id) AS posts_written
    FROM users au
    JOIN entries e ON e.author_user_id = au.id
    GROUP BY au.id
    ORDER BY posts_written DESC, name ASC
    LIMIT 8
  `).all();

  const mostLovedPages = db.prepare(`
    SELECT COALESCE(tu.alias, tu.display_name) AS name, COUNT(e.id) AS posts_received
    FROM users tu
    LEFT JOIN entries e ON e.target_user_id = tu.id
    GROUP BY tu.id
    ORDER BY posts_received DESC, name ASC
    LIMIT 8
  `).all();

  const contentMix = [
    { label: 'Text', value: core.total_text || 0 },
    { label: 'Image', value: core.total_image || 0 },
    { label: 'Audio', value: core.total_audio || 0 }
  ];

  return res.render('admin-metrics', {
    dailyPosts: dailyPosts.reverse(),
    dailySignups: dailySignups.reverse(),
    dailyLogins: dailyLogins.reverse(),
    core,
    postsPerUser,
    allowlistCoverage,
    weeklyActiveRate,
    topContributors,
    mostLovedPages,
    contentMix
  });
});

app.post('/admin/allowed-emails', requireAdmin, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email.endsWith('@iima.ac.in')) {
    req.flash('error', 'Only iima.ac.in emails can be allowlisted.');
    return res.redirect('/admin');
  }
  addAllowedEmail(email);
  req.flash('success', `Allowlisted ${email}`);
  return res.redirect('/admin');
});

app.post('/admin/allowed-emails/:id/delete', requireAdmin, (req, res) => {
  removeAllowedEmail(req.params.id);
  req.flash('success', 'Allowlisted email removed.');
  return res.redirect('/admin');
});

app.post('/admin/users/:id/delete', requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId)) {
    req.flash('error', 'Invalid user id.');
    return res.redirect('/admin');
  }

  db.prepare('DELETE FROM entries WHERE target_user_id = ? OR author_user_id = ?').run(userId, userId);
  db.prepare('DELETE FROM dino_scores WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  req.flash('success', 'User removed.');
  return res.redirect('/admin');
});

app.get('/admin/api/users', requireAdmin, (req, res) => {
  const q = String(req.query.q || '').trim();
  const users = db.prepare(`
    SELECT id, email, display_name, alias, share_code, last_login_at, created_at
    FROM users
    WHERE email LIKE ? OR display_name LIKE ? OR alias LIKE ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(`%${q}%`, `%${q}%`, `%${q}%`);
  res.json({ users });
});

app.get('/tt', requirePortalAccess, (req, res) => {
  const leaderboard = getDinoLeaderboard(20);
  let myBest = 0;
  if (req.user) {
    const myBestRow = db.prepare('SELECT best_score FROM dino_scores WHERE user_id = ?').get(req.user.id);
    myBest = myBestRow ? myBestRow.best_score : 0;
  } else if (req.session && req.session.isAdmin) {
    myBest = Number(req.session.adminTtBest || 0);
  }
  res.render('tt', { leaderboard, myBest });
});

app.get('/dino', requirePortalAccess, (_req, res) => res.redirect('/tt'));

app.get('/profile', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const myBestRow = db.prepare('SELECT best_score FROM dino_scores WHERE user_id = ?').get(req.user.id);
  const shareWriteUrl = `${baseUrl}/write/${user.share_code}`;
  const publicProfileUrl = `${baseUrl}/profile/${user.share_code}`;
  return res.render('profile', {
    user,
    ttHighScore: myBestRow ? myBestRow.best_score : 0,
    shareWriteUrl,
    publicProfileUrl
  });
});

app.get('/profile/showcase', requireAuth, (req, res) => {
  const entries = db.prepare(`
    SELECT e.*, COALESCE(au.alias, au.display_name) AS author_name
    FROM entries e
    JOIN users au ON au.id = e.author_user_id
    WHERE e.target_user_id = ?
    ORDER BY e.created_at DESC
  `).all(req.user.id);

  return res.render('profile-showcase', { entries });
});

app.get('/profile/:shareCode', requirePortalAccess, (req, res) => {
  const target = db.prepare(`
    SELECT id, email, display_name, alias, bio, picture_url, custom_picture_path, share_code, created_at, last_login_at
    FROM users
    WHERE share_code = ?
  `).get(req.params.shareCode);

  if (!target) {
    req.flash('error', 'Profile not found.');
    return res.redirect('/people');
  }

  const entries = db.prepare(`
    SELECT e.*, COALESCE(au.alias, au.display_name) AS author_name, au.share_code AS author_share_code
    FROM entries e
    JOIN users au ON au.id = e.author_user_id
    WHERE e.target_user_id = ?
    ORDER BY e.created_at DESC
  `).all(target.id);

  const targetAvatarUrl = target.custom_picture_path
    ? `/${target.custom_picture_path}`
    : (target.picture_url || '/default-avatar.svg');
  const targetBestRow = db.prepare('SELECT best_score FROM dino_scores WHERE user_id = ?').get(target.id);

  return res.render('profile-view', {
    target,
    entries,
    targetAvatarUrl,
    ttHighScore: targetBestRow ? targetBestRow.best_score : 0
  });
});

app.post('/profile', requireAuth, (req, res) => {
  const alias = String(req.body.alias || '').trim();
  const bio = String(req.body.bio || '').trim();
  const croppedImageData = String(req.body.cropped_image_data || '').trim();

  const aliasValue = alias.length ? alias.slice(0, 60) : null;
  const bioValue = bio.length ? bio.slice(0, 500) : null;

  let customPath;
  if (croppedImageData) {
    const match = croppedImageData.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      req.flash('error', 'Invalid cropped image data.');
      return res.redirect('/profile');
    }

    const mime = match[1];
    const base64 = match[2];
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const fileName = `${Date.now()}-profile.${ext}`;
    const outputPath = path.join(uploadsDir, fileName);

    try {
      fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
      customPath = `uploads/${fileName}`;
    } catch (_error) {
      req.flash('error', 'Failed to save cropped profile image.');
      return res.redirect('/profile');
    }
  }

  if (customPath) {
    db.prepare(`
      UPDATE users
      SET alias = ?, bio = ?, custom_picture_path = ?
      WHERE id = ?
    `).run(aliasValue, bioValue, customPath, req.user.id);
  } else {
    db.prepare(`
      UPDATE users
      SET alias = ?, bio = ?
      WHERE id = ?
    `).run(aliasValue, bioValue, req.user.id);
  }

  req.flash('success', 'Profile updated.');
  return res.redirect('/profile');
});

app.get('/api/tt/leaderboard', requirePortalAccess, (req, res) => {
  const leaderboard = getDinoLeaderboard(20);
  let myBest = 0;
  if (req.user) {
    const myBestRow = db.prepare('SELECT best_score FROM dino_scores WHERE user_id = ?').get(req.user.id);
    myBest = myBestRow ? myBestRow.best_score : 0;
  } else if (req.session && req.session.isAdmin) {
    myBest = Number(req.session.adminTtBest || 0);
  }
  res.json({ leaderboard, myBest });
});

app.get('/api/dino/leaderboard', requirePortalAccess, (req, res) => res.redirect('/api/tt/leaderboard'));

app.post('/api/tt/score', requirePortalAccess, (req, res) => {
  const score = Number(req.body.score);
  if (!Number.isFinite(score) || score < 0) {
    return res.status(400).json({ error: 'Invalid score' });
  }

  if (req.user) {
    const row = upsertDinoScore(req.user.id, Math.floor(score));
    if (!row) {
      return res.status(400).json({ error: 'Invalid score' });
    }
    return res.json({ bestScore: row.best_score });
  }

  if (req.session && req.session.isAdmin) {
    const safe = Math.floor(score);
    req.session.adminTtBest = Math.max(Number(req.session.adminTtBest || 0), safe);
    return res.json({ bestScore: req.session.adminTtBest });
  }

  return res.status(403).json({ error: 'Unauthorized' });
});

app.post('/api/dino/score', requirePortalAccess, (req, res) => res.redirect(307, '/api/tt/score'));

app.post('/admin/posts/:id/delete', requireAdmin, (req, res) => {
  const postId = Number(req.params.id);
  if (!Number.isInteger(postId)) {
    req.flash('error', 'Invalid post id.');
    return res.redirect('/admin');
  }
  db.prepare('DELETE FROM entries WHERE id = ?').run(postId);
  req.flash('success', 'Post removed.');
  const returnTo = String(req.body.return_to || '').trim();
  if (returnTo.startsWith('/')) return res.redirect(returnTo);
  return res.redirect('/admin');
});

app.get('/qr/:shareCode', requireAuth, async (req, res, next) => {
  try {
    const target = db.prepare('SELECT share_code FROM users WHERE share_code = ?').get(req.params.shareCode);
    if (!target) {
      return res.status(404).send('Not found');
    }

    const url = `${baseUrl}/write/${target.share_code}`;
    const pngBuffer = await QRCode.toBuffer(url, { width: 300, margin: 1 });
    res.setHeader('Content-Type', 'image/png');
    return res.send(pngBuffer);
  } catch (error) {
    return next(error);
  }
});

app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError || (err.message && err.message.includes('allowed'))) {
    req.flash('error', err.message);
    if (req.params && req.params.shareCode) {
      return res.redirect(`/write/${req.params.shareCode}`);
    }
    if (req.path === '/profile') {
      return res.redirect('/profile');
    }
    return res.redirect('/home');
  }

  console.error(err);
  return res.status(500).render('error', { error: err });
});

app.listen(PORT, () => {
  console.log(`Server started on ${baseUrl}`);
});
