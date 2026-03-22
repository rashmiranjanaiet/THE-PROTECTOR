require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const User = require('./src/models/User');
const Note = require('./src/models/Note');
const SecureDrop = require('./src/models/SecureDrop');
const { requireAuth } = require('./src/middleware/auth');
const { generateNumericCode } = require('./src/utils/crypto');
const { chatWithAryan } = require('./src/services/ai');
const { sendSecureCodeEmail } = require('./src/services/mail');
const {
  getFlightFeed,
  getIsroFeed,
  getNewsFeed,
  getEonetDisasters,
  getReliefDisasters,
  getWarFeed
} = require('./src/services/feeds');

const app = express();
const port = Number(process.env.PORT || 10000);
const uploadDir = path.join(__dirname, 'uploads');
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 5);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

function signToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      username: user.username,
      email: user.email
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function getAuthUserResponse(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email
  };
}

function pickImageExt(mimeType) {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.jpg';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${pickImageExt(file.mimetype)}`;
      cb(null, unique);
    }
  }),
  limits: {
    fileSize: maxUploadMb * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image uploads are allowed'));
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'THE PROTECTOR', now: new Date().toISOString() });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password || String(password).length < 6) {
      res.status(400).json({ error: 'username, email and password(>=6) are required' });
      return;
    }

    const existing = await User.findOne({
      $or: [{ email: String(email).toLowerCase().trim() }, { username: String(username).trim() }]
    });

    if (existing) {
      res.status(409).json({ error: 'User with this email/username already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await User.create({
      username: String(username).trim(),
      email: String(email).toLowerCase().trim(),
      passwordHash
    });

    const token = signToken(user);
    res.status(201).json({ token, user: getAuthUserResponse(user) });
  } catch (error) {
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      res.status(400).json({ error: 'identifier and password are required' });
      return;
    }

    const user = await User.findOne({
      $or: [{ email: String(identifier).toLowerCase().trim() }, { username: String(identifier).trim() }]
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = signToken(user);
    res.json({ token, user: getAuthUserResponse(user) });
  } catch (error) {
    res.status(500).json({ error: 'Login failed', details: error.message });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id).lean();
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user: getAuthUserResponse(user) });
});

app.get('/api/feeds/flight', requireAuth, async (_req, res) => {
  const data = await getFlightFeed();
  res.json(data);
});

app.get('/api/feeds/isro', requireAuth, async (_req, res) => {
  const data = await getIsroFeed();
  res.json(data);
});

app.get('/api/feeds/news', requireAuth, async (_req, res) => {
  const data = await getNewsFeed();
  res.json(data);
});

app.get('/api/feeds/disasters', requireAuth, async (_req, res) => {
  try {
    const markers = await getEonetDisasters();
    res.json({ source: 'EONET', markers });
  } catch (error) {
    res.status(502).json({ error: 'Disaster feed unavailable', details: error.message });
  }
});

app.get('/api/feeds/relief', requireAuth, async (_req, res) => {
  try {
    const events = await getReliefDisasters();
    res.json({ source: 'ReliefWeb', events });
  } catch (error) {
    res.status(502).json({ error: 'Relief feed unavailable', details: error.message });
  }
});

app.get('/api/feeds/war', requireAuth, async (_req, res) => {
  const data = await getWarFeed();
  res.json(data);
});

app.get('/api/dashboard/summary', requireAuth, async (_req, res) => {
  const [flight, isro, news, disasters, relief, war] = await Promise.allSettled([
    getFlightFeed(),
    getIsroFeed(),
    getNewsFeed(),
    getEonetDisasters(),
    getReliefDisasters(),
    getWarFeed()
  ]);

  res.json({
    flight: flight.status === 'fulfilled' ? flight.value : { markers: [], error: flight.reason?.message },
    isro: isro.status === 'fulfilled' ? isro.value : { items: [], error: isro.reason?.message },
    news:
      news.status === 'fulfilled'
        ? news.value
        : { global: [], india: [], videos: [], markets: [], war: [], error: news.reason?.message },
    disasters: disasters.status === 'fulfilled' ? { markers: disasters.value } : { markers: [], error: disasters.reason?.message },
    relief: relief.status === 'fulfilled' ? { events: relief.value } : { events: [], error: relief.reason?.message },
    war: war.status === 'fulfilled' ? war.value : { markers: [], error: war.reason?.message }
  });
});

app.post('/api/ai/chat', requireAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const response = await chatWithAryan({ message, history });
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Aryan AI failed', details: error.message });
  }
});

app.get('/api/notes', requireAuth, async (req, res) => {
  const notes = await Note.find({ userId: req.user.id }).sort({ updatedAt: -1 }).lean();
  res.json({ notes });
});

app.post('/api/notes', requireAuth, async (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    res.status(400).json({ error: 'title and content are required' });
    return;
  }

  const note = await Note.create({
    userId: req.user.id,
    title: String(title),
    content: String(content)
  });

  res.status(201).json({ note });
});

app.put('/api/notes/:id', requireAuth, async (req, res) => {
  const { title, content } = req.body;
  const note = await Note.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    {
      ...(title !== undefined ? { title: String(title) } : {}),
      ...(content !== undefined ? { content: String(content) } : {})
    },
    { new: true }
  );

  if (!note) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }

  res.json({ note });
});

app.delete('/api/notes/:id', requireAuth, async (req, res) => {
  const deleted = await Note.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!deleted) {
    res.status(404).json({ error: 'Note not found' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/secure/create', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const { message, recipientEmail } = req.body;
    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    let code = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = generateNumericCode(16);
      const exists = await SecureDrop.exists({ code: candidate });
      if (!exists) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      res.status(500).json({ error: 'Could not generate code. Try again.' });
      return;
    }

    const ttlHours = Number(process.env.SECURE_MESSAGE_TTL_HOURS || 72);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const created = await SecureDrop.create({
      code,
      message: String(message),
      imagePath: req.file ? `/uploads/${req.file.filename}` : null,
      createdBy: req.user.id,
      expiresAt
    });

    let emailed = false;
    if (recipientEmail) {
      try {
        const result = await sendSecureCodeEmail({ to: String(recipientEmail).trim(), code });
        emailed = Boolean(result.sent);
      } catch {
        emailed = false;
      }
    }

    res.status(201).json({
      code: created.code,
      expiresAt: created.expiresAt,
      imageUrl: created.imagePath,
      emailed
    });
  } catch (error) {
    res.status(500).json({ error: 'Secure message creation failed', details: error.message });
  }
});

app.post('/api/secure/open', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code || String(code).length !== 16) {
    res.status(400).json({ error: 'Valid 16-digit code is required' });
    return;
  }

  const doc = await SecureDrop.findOne({ code: String(code), used: false, expiresAt: { $gt: new Date() } });

  if (!doc) {
    res.status(404).json({ error: 'Code is invalid, expired, or already used' });
    return;
  }

  doc.used = true;
  await doc.save();

  res.json({
    message: doc.message,
    imageUrl: doc.imagePath,
    consumedAt: new Date().toISOString()
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: error.message || 'Unexpected server error' });
});

async function start() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing in environment');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is missing in environment');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  app.listen(port, () => {
    console.log(`THE PROTECTOR server running on http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('Startup failed:', error.message);
  process.exit(1);
});
