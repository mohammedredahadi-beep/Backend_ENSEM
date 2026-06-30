const express = require('express');
const router = express.Router();
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

module.exports = router;
