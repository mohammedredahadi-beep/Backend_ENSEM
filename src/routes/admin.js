const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const store = require('../services/store');
const { matchUserToLaureat } = require('../services/duplicate');
const { generatePassToken } = require('../services/jwt');
const { sendAccountApproved, sendAccountRejected, sendAgentInvite } = require('../services/mailer');
const { requireAuth } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Import CSV/Excel ─────────────────────────────────────────────────────────

router.post('/import', requireAuth(['admin']), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Fichier requis' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    // Normaliser les colonnes (accepter plusieurs orthographes)
    const normalized = rows.map(r => ({
      nom: r.Nom || r.nom || r.NOM || '',
      prenom: r.Prénom || r.Prenom || r.prenom || r.PRENOM || '',
      email: r.Email || r.email || r.EMAIL || '',
      filiere: r.Filière || r.Filiere || r.filiere || r.FILIERE || '',
      cin: r.CIN || r.cin || '',
      quota_invites: r['Quota Invités'] || r.quota_invites || r.QuotaInvites || 2,
    }));

    const  = await store.(normalized);
    res.json({ message: 'Import terminé', ...results });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: 'Erreur lors de l\'import : ' + e.message });
  }
});

// ─── Liste des lauréats ───────────────────────────────────────────────────────

router.get('/laureats', requireAuth(['admin']), async (req, res) => {
  const { filiere, present } = req.query;
  const filters = {};
  if (filiere) filters.filiere = filiere;
  if (present !== undefined) filters.present = present === 'true';
  const  = await store.(filters);
  res.json(laureats);
});

// ─── Modifier quota invités ───────────────────────────────────────────────────

router.put('/laureats/:id/quota', requireAuth(['admin']), async (req, res) => {
  const { quota } = req.body;
  if (!quota || quota < 1 || quota > 4) {
    return res.status(400).json({ error: 'Quota invalide (1 à 4)' });
  }
  const  = await store.(req.params.id, quota);
  if (!ok) return res.status(404).json({ error: 'Lauréat non trouvé' });
  res.json({ message: 'Quota mis à jour', quota });
});

// ─── Générer/régénérer un pass ────────────────────────────────────────────────

router.post('/laureats/:id/pass', requireAuth(['admin']), async (req, res) => {
  const  = await store.(req.params.id);
  if (!laureat) return res.status(404).json({ error: 'Lauréat non trouvé' });

  const token = generatePassToken(laureat, 120);
  await store.(laureat.id, true);

  // Enregistrer le JTI pour tracking
  const parts = token.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  await store.(claims.jti, laureat.id, claims.exp);

  res.json({ token, expires_in: 120, laureat_id: laureat.id });
});

// ─── Statistiques temps réel ──────────────────────────────────────────────────

router.get('/stats', requireAuth(['admin']), async (req, res) => {
  res.json(await store.());
});

// ─── Scans récents (alertes) ──────────────────────────────────────────────────

router.get('/scans', requireAuth(['admin']), async (req, res) => {
  const { limit = 100 } = req.query;
  res.json(await store.(parseInt(limit)));
});

// ─── Pass d'urgence (recherche par nom) ──────────────────────────────────────

router.post('/emergency-pass', requireAuth(['admin']), async (req, res) => {
  const { query } = req.body;
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Recherche trop courte' });
  }
  const  = await store.(query);
  res.json({ results, count: results.length });
});

router.post('/emergency-pass/:id/generate', requireAuth(['admin']), async (req, res) => {
  const  = await store.(req.params.id);
  if (!laureat) return res.status(404).json({ error: 'Lauréat non trouvé' });

  const token = generatePassToken(laureat, 3600); // 1h pour le pass papier
  const parts = token.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  await store.(claims.jti, laureat.id, claims.exp);

  res.json({ token, laureat, expires_in: 3600, emergency: true });
});

// ─── File de validation des comptes ──────────────────────────────────────────

router.get('/validation-queue', requireAuth(['admin']), async (req, res) => {
  const  = await store.();
  const  = await store.();

  // Enrichir avec le matching CSV
  const enriched = pendingUsers.map(user => {
    const match = matchUserToLaureat(user, laureats);
    return {
      ...user,
      csv_match: match,
    };
  });

  res.json({ count: enriched.length, users: enriched });
});

router.put('/validate/:userId', requireAuth(['admin']), async async (req, res) => {
  try {
    const { action, motif, laureat_id } = req.body; // action: 'approve' | 'reject'
    const  = await store.(req.params.userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    if (action === 'approve') {
      await store.(req.params.userId, 'actif');

      // Lier à un lauréat (si non déjà lié)
      let laureat = await store.(req.params.userId);
      if (!laureat && laureat_id) {
        laureat = await store.(laureat_id);
        if (laureat) laureat.user_id = req.params.userId;
      }
      if (!laureat) {
        // Créer un lauréat automatiquement depuis les infos du compte
        laureat = await store.({
          userId: req.params.userId,
          nom: user.nom,
          prenom: user.prenom,
          email: user.email,
          filiere: user.filiere || 'Non spécifiée',
          cin: user.cin,
          quota_invites: 2,
        });
      }

      // Générer le pass
      const token = generatePassToken(laureat, 120);
      const parts = token.split('.');
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      await store.(claims.jti, laureat.id, claims.exp);
      await store.(laureat.id, true);

      await sendAccountApproved(user, laureat);
      res.json({ message: 'Compte approuvé. Email envoyé au lauréat.', laureat });
    } else if (action === 'reject') {
      await store.(req.params.userId, 'rejete');
      await sendAccountRejected(user, motif || 'Non spécifié');
      res.json({ message: 'Compte refusé. Email envoyé à l\'utilisateur.' });
    } else {
      res.status(400).json({ error: 'Action invalide (approve | reject)' });
    }
  } catch (e) {
    console.error('Validate error:', e);
    res.status(500).json({ error: 'Erreur de validation' });
  }
});

// ─── Gestion des agents ───────────────────────────────────────────────────────

router.get('/agents', requireAuth(['admin']), async (req, res) => {
  const  = await store.({ role: 'agent' });
  res.json(agents);
});

router.post('/agent-invite', requireAuth(['admin']), async async (req, res) => {
  try {
    const { email } = req.body;
    const  = await store.(req.user.sub);
    const  = await store.(req.user.sub);

    if (email) {
      await sendAgentInvite(email, code, `${admin.prenom} ${admin.nom}`);
    }

    res.json({ code, message: email ? `Invitation envoyée à ${email}` : 'Code généré' });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de la génération du code' });
  }
});

router.put('/agents/:id/status', requireAuth(['admin']), async (req, res) => {
  const { status } = req.body;
  const  = await store.(req.params.id, status);
  if (!ok) return res.status(404).json({ error: 'Agent non trouvé' });
  res.json({ message: 'Statut mis à jour' });
});

module.exports = router;
