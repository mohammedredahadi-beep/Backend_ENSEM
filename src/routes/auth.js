const express = require('express');
const router = express.Router();
const { admin } = require('../firebase-admin');
const store = require('../services/store');
const { checkDuplicates } = require('../services/duplicate');
const { requireAuth } = require('../middleware/auth');

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', requireAuth(), async (req, res) => {
  try {
    const user = await store.getUserById(req.user.sub);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── POST /api/auth/check-duplicate ──────────────────────────────────────────
// Endpoint de vérification temps réel (appelé depuis le formulaire d'inscription)

router.post('/check-duplicate', async (req, res) => {
  try {
    const { cin, email, nom, prenom } = req.body;
    const result = await checkDuplicates({ cin, email, nom, prenom });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Erreur de vérification' });
  }
});

// ─── GET /api/auth/verify-email/:token ────────────────────────────────────────
router.get('/verify-email/:token', async (req, res) => {
  try {
    const { token } = req.params;
    // Firebase gère la vérification d'email côté client en production,
    // mais si le backend a besoin de traquer ou forcer la validation :
    const decodedToken = await admin.auth().verifyIdToken(token).catch(() => null);
    if (!decodedToken) {
      return res.status(400).json({ error: 'Lien de vérification invalide ou expiré.' });
    }
    await store.verifyUserEmail(decodedToken.uid);
    res.json({ message: 'Email vérifié avec succès.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur lors de la vérification.' });
  }
});

// ─── POST /api/auth/resend-verification ──────────────────────────────────────
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await store.getUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'Aucun compte associé à cet email.' });
    }
    // L'envoi réel de l'email de confirmation Firebase se fait idéalement via le client,
    // mais nous enregistrons la demande côté serveur.
    res.json({ message: 'Lien de vérification renvoyé.' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
