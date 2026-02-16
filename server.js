const express = require('express');
const fs = require('fs');
const os = require('os');
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

const isVercel = Boolean(process.env.VERCEL);
const isProduction = process.env.NODE_ENV === 'production' || isVercel;
// Vercel serverless is read-only outside /tmp, so keep mutable data there.
const runtimeRoot =
  process.env.RUNTIME_ROOT || (isVercel ? path.join(os.tmpdir(), 'xtube-cloud') : __dirname);
const profilePicsDir = process.env.PROFILE_PICS_DIR
  || path.join(runtimeRoot, isVercel ? 'profile-pics' : 'Profile Pics');
const dataDir = process.env.DATA_DIR || path.join(runtimeRoot, 'data');
const dbPath = path.join(dataDir, 'db.json');

ensureDir(profilePicsDir);
ensureDir(dataDir);

const cloudVideos = [
  {
    id: 'b8a7d19091bc6407bcb56587eef43cfb',
    title: 'Cloudflare Stream: Launch Deck',
    embedUrl:
      'https://customer-jo4j2pl3ibe2d4s4.cloudflarestream.com/b8a7d19091bc6407bcb56587eef43cfb/iframe?poster=https%3A%2F%2Fcustomer-jo4j2pl3ibe2d4s4.cloudflarestream.com%2Fb8a7d19091bc6407bcb56587eef43cfb%2Fthumbnails%2Fthumbnail.jpg%3Ftime%3D%26height%3D600',
    posterUrl:
      'https://customer-jo4j2pl3ibe2d4s4.cloudflarestream.com/b8a7d19091bc6407bcb56587eef43cfb/thumbnails/thumbnail.jpg?time=&height=600',
    uploadedAt: '2024-10-02T18:00:00Z',
  },
  {
    id: '6406a711dca66a2cf65f221c76a0934f',
    title: 'Cloudflare Stream: Platform Walkthrough',
    embedUrl:
      'https://customer-jo4j2pl3ibe2d4s4.cloudflarestream.com/6406a711dca66a2cf65f221c76a0934f/iframe?poster=https%3A%2F%2Fcustomer-jo4j2pl3ibe2d4s4.cloudflarestream.com%2F6406a711dca66a2cf65f221c76a0934f%2Fthumbnails%2Fthumbnail.jpg%3Ftime%3D%26height%3D600',
    posterUrl:
      'https://customer-jo4j2pl3ibe2d4s4.cloudflarestream.com/6406a711dca66a2cf65f221c76a0934f/thumbnails/thumbnail.jpg?time=&height=600',
    uploadedAt: '2024-10-05T18:00:00Z',
  },
  {
    id: '856d7c5b0a033bc414d330aa998b97fa',
    title: 'Cloudflare Stream: Edge Delivery',
    embedUrl:
      'https://customer-jo4j2pl3ibe2d4s4.cloudflarestream.com/856d7c5b0a033bc414d330aa998b97fa/iframe?poster=https%3A%2F%2Fcustomer-jo4j2pl3ibe2d4s4.cloudflarestream.com%2F856d7c5b0a033bc414d330aa998b97fa%2Fthumbnails%2Fthumbnail.jpg%3Ftime%3D%26height%3D600',
    posterUrl:
      'https://customer-jo4j2pl3ibe2d4s4.cloudflarestream.com/856d7c5b0a033bc414d330aa998b97fa/thumbnails/thumbnail.jpg?time=&height=600',
    uploadedAt: '2024-10-08T18:00:00Z',
  },
];

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

app.use((req, res, next) => {
  if (req.method !== 'GET') {
    return next();
  }
  return res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`XTube server running at http://${HOST}:${PORT}`);
  });
}

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
    secure: isProduction,
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
  const ids = cloudVideos.map((video) => video.id);

  // purge metadata for removed files
  Object.keys(db.videos).forEach((key) => {
    if (!ids.includes(key)) {
      delete db.videos[key];
      delete db.reactions[key];
    }
  });

  ids.forEach((id) => {
    if (!db.videos[id]) {
      db.videos[id] = {
        views: 0,
        likes: 0,
        dislikes: 0,
        comments: [],
      };
    } else {
      db.videos[id].comments = db.videos[id].comments || [];
      db.videos[id].views = db.videos[id].views || 0;
      db.videos[id].likes = db.videos[id].likes || 0;
      db.videos[id].dislikes = db.videos[id].dislikes || 0;
    }
  });

  persistDb();

  return cloudVideos
    .map((video) => {
      const meta = db.videos[video.id];
      return {
        id: video.id,
        title: video.title,
        embedUrl: video.embedUrl,
        posterUrl: video.posterUrl,
        views: meta.views || 0,
        likes: meta.likes || 0,
        dislikes: meta.dislikes || 0,
        commentsCount: meta.comments.length,
        uploadedAt: video.uploadedAt,
      };
    })
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

function getVideoMeta(videoId) {
  const exists = cloudVideos.some((video) => video.id === videoId);
  if (!exists) {
    return null;
  }
  if (!db.videos[videoId]) {
    db.videos[videoId] = { views: 0, likes: 0, dislikes: 0, comments: [] };
  }
  return db.videos[videoId];
}

module.exports = app;
