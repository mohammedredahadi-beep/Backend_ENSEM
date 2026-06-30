const express = require('express');
const cors = require('cors');
const path = require('path');
const { initKeys } = require('./services/jwt');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const passRoutes = require('./routes/pass');
const scanRoutes = require('./routes/scan');

const app = express();
const PORT = process.env.PORT || 3001;

// Autoriser CORS pour le frontend (Firebase Hosting ou localhost)
const allowedOrigins = ['http://localhost:5173', 'https://ceremonie-access.web.app', 'https://ceremonie-access.firebaseapp.com'];
app.use(cors({ 
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy violation'));
    }
  }, 
  credentials: true 
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Init keys middleware
app.use(async (req, res, next) => {
  try {
    await initKeys();
    next();
  } catch (err) {
    next(err);
  }
});

// Routes
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/pass', passRoutes);
app.use('/scan', scanRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), env: 'render' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur interne' });
});

async function start() {
  try {
    await initKeys();
    app.listen(PORT, () => {
      console.log(`✅ ENSEM ACCESS Backend démarré sur le port ${PORT}`);
    });
  } catch (err) {
    console.error("Erreur au démarrage", err);
  }
}

start();
