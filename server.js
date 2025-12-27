const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.disable('x-powered-by');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'xtube-secret';
const COOKIE_NAME = 'xtube_token';
const GUEST_COOKIE = 'xtube_guest';
const MAX_UPLOAD_MB = 8;

const videosDir = path.join(__dirname, 'videos');
const profilePicsDir = path.join(__dirname, 'Profile Pics');
const dataDir = path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'db.json');

ensureDir(videosDir);
ensureDir(profilePicsDir);
ensureDir(dataDir);

let db = loadDb();
syncVideos();

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/profile-pics', express.static(profilePicsDir));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, profilePicsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `${req.user.id}${ext.toLowerCase()}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

app.use(attachUser);

app.get('/api/me', (req, res) => {
  if (!req.user) {
    return res.json({ user: null });
  }
  res.json({ user: publicUser(req.user) });
});

app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: 'Username must be 3-32 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const exists = db.users.find(
    (u) => u.username.toLowerCase() === String(username).toLowerCase()
  );
  if (exists) {
    return res.status(409).json({ error: 'Username already exists' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    username,
    passwordHash,
    profilePic: null,
  };
  db.users.push(newUser);
  persistDb();
  setAuthCookie(res, newUser.id);
  res.json({ user: publicUser(newUser) });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find(
    (u) => u.username.toLowerCase() === String(username || '').toLowerCase()
  );
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  setAuthCookie(res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (_req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.status(204).end();
});

app.get('/api/videos', (_req, res) => {
  const videos = syncVideos();
  res.json({ videos });
});

app.post('/api/videos/:id/view', (req, res) => {
  const videoId = decodeId(req.params.id);
  const meta = getVideoMeta(videoId);
  if (!meta) {
    return res.status(404).json({ error: 'Video not found' });
  }
  meta.views += 1;
  persistDb();
  res.json({ views: meta.views });
});

app.post('/api/videos/:id/react', (req, res) => {
  const videoId = decodeId(req.params.id);
  const meta = getVideoMeta(videoId);
  if (!meta) {
    return res.status(404).json({ error: 'Video not found' });
  }
  const { type } = req.body || {};
  if (!['like', 'dislike'].includes(type)) {
    return res.status(400).json({ error: 'Reaction must be like or dislike' });
  }
  const userKey = ensureGuestKey(req, res);
  db.reactions[videoId] = db.reactions[videoId] || {};
  const existing = db.reactions[videoId][userKey];
  if (existing === type) {
    return res.json({
      likes: meta.likes,
      dislikes: meta.dislikes,
    });
  }
  if (existing === 'like') {
    meta.likes = Math.max(0, meta.likes - 1);
  } else if (existing === 'dislike') {
    meta.dislikes = Math.max(0, meta.dislikes - 1);
  }
  if (type === 'like') {
    meta.likes += 1;
  } else if (type === 'dislike') {
    meta.dislikes += 1;
  }
  db.reactions[videoId][userKey] = type;
  persistDb();
  res.json({ likes: meta.likes, dislikes: meta.dislikes });
});

app.get('/api/videos/:id/comments', (req, res) => {
  const videoId = decodeId(req.params.id);
  const meta = getVideoMeta(videoId);
  if (!meta) {
    return res.status(404).json({ error: 'Video not found' });
  }
  res.json({ comments: meta.comments || [] });
});

app.post('/api/videos/:id/comments', requireAuth, (req, res) => {
  const videoId = decodeId(req.params.id);
  const meta = getVideoMeta(videoId);
  if (!meta) {
    return res.status(404).json({ error: 'Video not found' });
  }
  const text = String(req.body?.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Comment cannot be empty' });
  }
  const comment = {
    id: uuidv4(),
    userId: req.user.id,
    username: req.user.username,
    text: text.slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  meta.comments.push(comment);
  persistDb();
  res.status(201).json({ comment });
});

app.post('/api/profile-picture', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    const user = req.user;
    user.profilePic = req.file.filename;
    persistDb();
    res.json({ user: publicUser(user) });
  });
});

app.get('/videos/:file', (req, res) => {
  const safeName = decodeId(req.params.file);
  const filePath = path.join(videosDir, safeName);
  if (!filePath.startsWith(videosDir) || !fs.existsSync(filePath)) {
    return res.status(404).end();
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return res.status(416).send('Requested range not satisfiable');
    }

    let start = match[1] === '' ? NaN : parseInt(match[1], 10);
    let end = match[2] === '' ? NaN : parseInt(match[2], 10);

    // Support suffix byte ranges (e.g., bytes=-500000 to fetch moov atom)
    if (Number.isNaN(start) && !Number.isNaN(end)) {
      const suffixLength = Math.min(end, fileSize);
      start = fileSize - suffixLength;
      end = fileSize - 1;
    } else {
      if (Number.isNaN(start)) start = 0;
      if (Number.isNaN(end) || end >= fileSize) end = fileSize - 1;
    }

    if (start < 0 || start >= fileSize || start > end) {
      return res.status(416).send('Requested range not satisfiable');
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': getMimeType(filePath),
    });
    return fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  res.writeHead(200, {
    'Content-Length': fileSize,
    'Content-Type': getMimeType(filePath),
    'Accept-Ranges': 'bytes',
  });
  return fs.createReadStream(filePath).pipe(res);
});

app.use((req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`XTube server running at http://${HOST}:${PORT}`);
});

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function loadDb() {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeDb(parsed);
  } catch {
    return normalizeDb({ ...defaultDb() });
  }
}

function persistDb() {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function defaultDb() {
  return { users: [], videos: {}, reactions: {} };
}

function normalizeDb(data) {
  return {
    users: Array.isArray(data.users) ? data.users : [],
    videos: data.videos && typeof data.videos === 'object' ? data.videos : {},
    reactions: data.reactions && typeof data.reactions === 'object' ? data.reactions : {},
  };
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    profilePicUrl: user.profilePic ? `/profile-pics/${encodeURIComponent(user.profilePic)}` : null,
  };
}

function attachUser(req, _res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find((u) => u.id === payload.id);
    if (user) {
      req.user = user;
    }
  } catch {
    // ignore bad token
  }
  return next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return next();
}

function setAuthCookie(res, userId) {
  const token = jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '14d' });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 14,
  });
}

function ensureGuestKey(req, res) {
  let guestId = req.cookies[GUEST_COOKIE];
  if (!guestId) {
    guestId = uuidv4();
    res.cookie(GUEST_COOKIE, guestId, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
  }
  if (req.user) {
    return req.user.id;
  }
  return guestId;
}

function decodeId(rawId) {
  return decodeURIComponent(rawId);
}

function syncVideos() {
  ensureDir(videosDir);
  const files = fs.readdirSync(videosDir).filter(isVideoFile);

  // purge metadata for removed files
  Object.keys(db.videos).forEach((key) => {
    if (!files.includes(key)) {
      delete db.videos[key];
      delete db.reactions[key];
    }
  });

  files.forEach((file) => {
    if (!db.videos[file]) {
      db.videos[file] = {
        views: 0,
        likes: 0,
        dislikes: 0,
        comments: [],
      };
    } else {
      db.videos[file].comments = db.videos[file].comments || [];
      db.videos[file].views = db.videos[file].views || 0;
      db.videos[file].likes = db.videos[file].likes || 0;
      db.videos[file].dislikes = db.videos[file].dislikes || 0;
    }
  });

  persistDb();

  return files
    .map((file) => {
      const stats = fs.statSync(path.join(videosDir, file));
      const baseTitle = path.basename(file, path.extname(file));
      const meta = db.videos[file];
      return {
        id: encodeURIComponent(file),
        filename: file,
        title: baseTitle,
        url: `/videos/${encodeURIComponent(file)}`,
        views: meta.views || 0,
        likes: meta.likes || 0,
        dislikes: meta.dislikes || 0,
        commentsCount: meta.comments.length,
        uploadedAt: stats.mtime,
      };
    })
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

function getVideoMeta(videoId) {
  const filePath = path.join(videosDir, videoId);
  if (!filePath.startsWith(videosDir) || !fs.existsSync(filePath)) {
    return null;
  }
  if (!db.videos[videoId]) {
    db.videos[videoId] = { views: 0, likes: 0, dislikes: 0, comments: [] };
  }
  return db.videos[videoId];
}

function isVideoFile(file) {
  const allowed = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];
  const ext = path.extname(file).toLowerCase();
  return allowed.includes(ext);
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.m4v': 'video/x-m4v',
  };
  return map[ext] || 'application/octet-stream';
}
