const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const store = require('../services/store');
const { checkDuplicates } = require('../services/duplicate');
const { generateSessionToken } = require('../services/jwt');
const { sendEmailVerification } = require('../services/mailer');
const { requireAuth } = require('../middleware/auth');

// ─── POST /api/auth/register ─────────────────────────────────────────────────

router.post('/register', async async (req, res) => {
  try {
    const { nom, prenom, email, password, cin, filiere, role = 'laureate', invite_code } = req.body;

    // Validation champs obligatoires
    if (!nom || !prenom || !email || !password) {
      return res.status(400).json({ error: 'Champs obligatoires : nom, prenom, email, password' });
    }

    // Validation format email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Format email invalide' });
    }

    // Validation mot de passe (min 8 chars, majuscule, chiffre)
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 8 caractères, une majuscule et un chiffre',
      });
    }

    // Validation code invitation pour agents
    if (role === 'agent') {
      if (!invite_code) {
        return res.status(400).json({ error: 'Code d\'invitation requis pour les agents' });
      }
      if (!await store.(invite_code)) {
        return res.status(400).json({ error: 'Code d\'invitation invalide ou déjà utilisé' });
      }
    }

    // Vérification doublons
    const dupCheck = await checkDuplicates({ cin, email, nom, prenom });
    if (dupCheck.hasDuplicate) {
      return res.status(409).json({
        error: dupCheck.message,
        type: dupCheck.type,
      });
    }

    // Création du compte
    const newUser = await await store.({
      nom, prenom, email, password,
      role: role === 'agent' ? 'agent' : 'laureate',
      cin,
    });

    // Utilisation du code invitation
    if (role === 'agent' && invite_code) {
      await store.(invite_code, newUser.id);
    }

    // Génération token vérification email
    const  = await store.(newUser.id);
    await sendEmailVerification(newUser, verifToken);

    // Retourner similarités si fuzzy match détecté
    const response = {
      message: 'Compte créé. Veuillez vérifier votre email pour activer votre compte.',
      userId: newUser.id,
    };

    if (dupCheck.type === 'fuzzy_name' && dupCheck.similarUsers.length > 0) {
      response.warning = dupCheck.message;
      response.similar_users_count = dupCheck.similarUsers.length;
    }

    res.status(201).json(response);
  } catch (e) {
    console.error('Register error:', e);
    res.status(500).json({ error: 'Erreur lors de la création du compte' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', async async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email et mot de passe requis' });
    }

    const  = await store.(email);
    if (!user) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const validPwd = await bcrypt.compare(password, user.password);
    if (!validPwd) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    // Vérifications de statut
    if (!user.email_verified) {
      return res.status(403).json({
        error: 'Veuillez vérifier votre email avant de vous connecter.',
        status: 'email_non_verifie',
      });
    }

    if (user.status === 'email_verifie') {
      return res.status(403).json({
        error: 'Votre compte est en attente de validation par l\'administration.',
        status: 'en_attente_validation',
      });
    }

    if (user.status === 'rejete') {
      return res.status(403).json({
        error: 'Votre compte a été refusé. Contactez l\'administration.',
        status: 'rejete',
      });
    }

    if (user.status !== 'actif') {
      return res.status(403).json({ error: 'Compte inactif.', status: user.status });
    }

    const token = generateSessionToken(user);
    const { password: _, ...safeUser } = user;

    res.json({
      token,
      user: safeUser,
      expires_in: 86400,
    });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Erreur de connexion' });
  }
});

// ─── GET /api/auth/verify-email/:token ───────────────────────────────────────

router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const  = await store.(token);

    if (!userId) {
      return res.status(400).json({ error: 'Lien de vérification invalide ou expiré.' });
    }

    await store.(userId);
    const  = await store.(userId);

    res.json({
      message: 'Email vérifié avec succès. Votre compte est en attente de validation admin.',
      user: { id: user.id, nom: user.nom, prenom: user.prenom, status: user.status },
    });
  } catch (e) {
    res.status(500).json({ error: 'Erreur de vérification' });
  }
});

// ─── POST /api/auth/resend-verification ──────────────────────────────────────

router.post('/resend-verification', async async (req, res) => {
  try {
    const { email } = req.body;
    const  = await store.(email);
    if (!user || user.email_verified) {
      return res.json({ message: 'Si cet email existe, un nouveau lien a été envoyé.' });
    }
    const  = await store.(user.id);
    await sendEmailVerification(user, verifToken);
    res.json({ message: 'Email de vérification renvoyé.' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors du renvoi' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', requireAuth(), async (req, res) => {
  const  = await store.(req.user.sub);
  if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
  res.json(user);
});

// ─── POST /api/auth/check-duplicate ──────────────────────────────────────────
// Endpoint de vérification temps réel (appelé depuis le formulaire d'inscription)

router.post('/check-duplicate', async async (req, res) => {
  try {
    const { cin, email, nom, prenom } = req.body;
    const result = await checkDuplicates({ cin, email, nom, prenom });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erreur de vérification' });
  }
});

module.exports = router;
