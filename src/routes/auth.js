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

// ─── POST /api/auth/pre-register ─────────────────────────────────────────────
// Vérifie les droits d'inscription avant la création dans Firebase Auth
router.post('/pre-register', async (req, res) => {
  try {
    const { email, role, invite_code } = req.body;

    if (role === 'agent') {
      if (!invite_code) {
        return res.status(400).json({ error: "Code d'invitation requis pour s'inscrire comme agent." });
      }
      const valid = await store.isInviteCodeValid(invite_code, email);
      if (!valid) {
        return res.status(400).json({ error: "Code d'invitation invalide, expiré (5 min) ou non associé à cet e-mail." });
      }
    } else {
      // Pour les lauréats, l'email doit être pré-autorisé dans la liste d'importation
      const authorized = await store.isEmailAuthorized(email);
      if (!authorized) {
        return res.status(400).json({ error: "Votre adresse e-mail n'est pas autorisée à s'inscrire. Veuillez contacter l'administration." });
      }
    }

    res.json({ success: true, message: 'Inscription autorisée.' });
  } catch (e) {
    console.error('Pre-register error:', e);
    res.status(500).json({ error: 'Erreur serveur lors de la validation préliminaire.' });
  }
});

// ─── POST /api/auth/complete-profile ─────────────────────────────────────────
// Finalise le profil du lauréat lors de sa première connexion
router.post('/complete-profile', requireAuth(['laureate']), async (req, res) => {
  try {
    const { nom, prenom, cin, filiere, telephone, quota_invites } = req.body;
    const userId = req.user.sub;

    if (!nom || !prenom || !cin || !filiere || !telephone) {
      return res.status(400).json({ error: 'Veuillez remplir tous les champs obligatoires.' });
    }

    // Récupérer le lauréat original pour valider que le quota d'invités demandé ne dépasse pas la limite
    const laureat = await store.getLaureatByUserId(userId);
    if (!laureat) {
      return res.status(404).json({ error: 'Fiche lauréat introuvable.' });
    }

    if (parseInt(quota_invites, 10) > laureat.quota_invites) {
      return res.status(400).json({ error: `Le nombre d'invités dépasse votre quota maximum autorisé (${laureat.quota_invites}).` });
    }

    await store.completeLaureatProfile(userId, {
      nom, prenom, cin, filiere, telephone, quota_invites
    });

    res.json({ success: true, message: 'Profil complété avec succès.' });
  } catch (e) {
    console.error('Complete profile error:', e);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du profil.' });
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
    res.json({ message: 'Lien de vérification renvoyé.' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
