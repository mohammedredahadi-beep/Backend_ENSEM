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

    // Colonnes du fichier Excel : "Adresse e-mail", "Nom complet", "Filière", "Numéro de téléphone", "CIN", "Quota invite"
    const normalized = rows.map(r => ({
      nom_complet: (r['Nom complet'] || r.nom_complet || '').trim(),
      email:       r['Adresse e-mail'] || r.email || r.Email || r.EMAIL || '',
      filiere:     r['Filière'] || r.Filiere || r.filiere || '',
      cin:         r.CIN || r.cin || '',
      telephone:   r['Numéro de téléphone'] || r.telephone || r.Telephone || '',
      quota_invites: parseInt(r['Quota invite'] || r['Quota Invités'] || r.quota_invites || 2, 10),
    }));

    const results = await store.bulkImportLaureats(normalized);
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
  const laureats = await store.getAllLaureats(filters);
  res.json(laureats);
});

// ─── Ajouter un lauréat manuellement ─────────────────────────────────────────

router.post('/laureats', requireAuth(['admin']), async (req, res) => {
  try {
    const { nom_complet, email, filiere, cin, telephone, quota_invites } = req.body;
    if (!nom_complet || !email) {
      return res.status(400).json({ error: 'Nom complet et email sont requis' });
    }
    const existing = await store.getLaureatByEmail(email);
    if (existing) return res.status(409).json({ error: 'Un lauréat avec cet email existe déjà' });

    const laureat = await store.createLaureat({
      nom_complet: nom_complet.trim().toUpperCase(),
      email: email.toLowerCase().trim(),
      filiere: filiere || 'Non spécifiée',
      cin: cin ? cin.toUpperCase().trim() : null,
      telephone: telephone || null,
      quota_invites: parseInt(quota_invites || 2, 10),
      photo_url: null,
    });
    res.status(201).json(laureat);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Modifier un lauréat (nom, filière, email, cin, téléphone, quota) ─────────

router.put('/laureats/:id', requireAuth(['admin']), async (req, res) => {
  try {
    const { nom_complet, email, filiere, cin, telephone, quota_invites } = req.body;
    const ok = await store.updateLaureat(req.params.id, {
      nom_complet: nom_complet ? nom_complet.trim().toUpperCase() : undefined,
      email: email ? email.toLowerCase().trim() : undefined,
      filiere,
      cin: cin ? cin.toUpperCase().trim() : null,
      telephone: telephone || null,
      quota_invites: quota_invites !== undefined ? parseInt(quota_invites, 10) : undefined,
    });
    if (!ok) return res.status(404).json({ error: 'Lauréat non trouvé' });
    res.json({ message: 'Lauréat mis à jour' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Supprimer un lauréat ─────────────────────────────────────────────────────

router.delete('/laureats/:id', requireAuth(['admin']), async (req, res) => {
  try {
    const ok = await store.deleteLaureat(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Lauréat non trouvé' });
    res.json({ message: 'Lauréat supprimé' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Basculer présence manuellement ──────────────────────────────────────────

router.put('/laureats/:id/presence', requireAuth(['admin']), async (req, res) => {
  try {
    const { present } = req.body;
    await store.setLaureatPresence(req.params.id, !!present);
    res.json({ message: 'Présence mise à jour', present: !!present });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Modifier quota invités ───────────────────────────────────────────────────

router.put('/laureats/:id/quota', requireAuth(['admin']), async (req, res) => {
  const { quota } = req.body;
  if (!quota || quota < 1 || quota > 4) {
    return res.status(400).json({ error: 'Quota invalide (1 à 4)' });
  }
  const ok = await store.updateLaureatQuota(req.params.id, quota);
  if (!ok) return res.status(404).json({ error: 'Lauréat non trouvé' });
  res.json({ message: 'Quota mis à jour', quota });
});

// ─── Générer/régénérer un pass ────────────────────────────────────────────────

router.post('/laureats/:id/pass', requireAuth(['admin']), async (req, res) => {
  const laureat = await store.getLaureatById(req.params.id);
  if (!laureat) return res.status(404).json({ error: 'Lauréat non trouvé' });

  const token = generatePassToken(laureat, 120);
  await store.setLaureatPassGenerated(laureat.id, true);

  // Enregistrer le JTI pour tracking
  const parts = token.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  await store.registerToken(claims.jti, laureat.id, claims.exp);

  res.json({ token, expires_in: 120, laureat_id: laureat.id });
});

// ─── Statistiques temps réel ──────────────────────────────────────────────────

router.get('/stats', requireAuth(['admin']), async (req, res) => {
  res.json(await store.getStats());
});

// ─── Scans récents (alertes) ──────────────────────────────────────────────────

router.get('/scans', requireAuth(['admin']), async (req, res) => {
  const { limit = 100 } = req.query;
  res.json(await store.getRecentScans(parseInt(limit)));
});

// ─── Pass d'urgence (recherche par nom) ──────────────────────────────────────

router.post('/emergency-pass', requireAuth(['admin']), async (req, res) => {
  const { query } = req.body;
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Recherche trop courte' });
  }
  const results = await store.searchLaureatsByName(query);
  res.json({ results, count: results.length });
});

router.post('/emergency-pass/:id/generate', requireAuth(['admin']), async (req, res) => {
  const laureat = await store.getLaureatById(req.params.id);
  if (!laureat) return res.status(404).json({ error: 'Lauréat non trouvé' });

  const token = generatePassToken(laureat, 3600); // 1h pour le pass papier
  const parts = token.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  await store.registerToken(claims.jti, laureat.id, claims.exp);

  res.json({ token, laureat, expires_in: 3600, emergency: true });
});

// ─── File de validation des comptes ──────────────────────────────────────────

router.get('/validation-queue', requireAuth(['admin']), async (req, res) => {
  const pendingUsers = await store.getAllPendingUsers();
  const laureats = await store.getAllLaureats();

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

router.put('/validate/:userId', requireAuth(['admin']), async (req, res) => {
  try {
    const { action, motif, laureat_id } = req.body; // action: 'approve' | 'reject'
    const user = await store.getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    if (action === 'approve') {
      await store.updateUserStatus(req.params.userId, 'actif');

      // Lier à un lauréat (si non déjà lié)
      let laureat = await store.getLaureatByUserId(req.params.userId);
      if (!laureat && laureat_id) {
        // Lier le compte à un lauréat existant (importé via CSV)
        laureat = await store.getLaureatById(laureat_id);
        if (laureat) {
          await store.linkUserToLaureat(laureat_id, req.params.userId);
          laureat = await store.getLaureatById(laureat_id); // Recharger avec user_id
        }
      }
      if (!laureat) {
        // Créer un lauréat automatiquement depuis les infos du compte
        laureat = await store.createLaureat({
          user_id: req.params.userId,
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
      await store.registerToken(claims.jti, laureat.id, claims.exp);
      await store.setLaureatPassGenerated(laureat.id, true);

      await sendAccountApproved(user, laureat);
      res.json({ message: 'Compte approuvé. Email envoyé au lauréat.', laureat });
    } else if (action === 'reject') {
      await store.updateUserStatus(req.params.userId, 'rejete');
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
  const agents = await store.getAllUsers({ role: 'agent' });
  res.json(agents);
});

router.post('/agent-invite', requireAuth(['admin']), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "L'adresse e-mail de l'agent est requise." });
    }
    const adminUser = await store.getUserById(req.user.sub);
    const code = await store.createInviteCode(req.user.sub, email);

    let emailSent = false;
    let emailError = '';

    try {
      await sendAgentInvite(email, code, adminUser ? `${adminUser.prenom} ${adminUser.nom}` : 'Administration');
      emailSent = true;
    } catch (mailErr) {
      console.error('❌ Erreur d\'envoi d\'e-mail d\'invitation:', mailErr);
      emailError = ` (l'envoi du mail a échoué : ${mailErr.message})`;
    }

    res.json({ 
      code, 
      message: email 
        ? (emailSent ? `Invitation envoyée à ${email}` : `Code d'invitation généré pour ${email}${emailError}`)
        : 'Code généré' 
    });
  } catch (e) {
    console.error('❌ Erreur lors de la génération du code d\'invitation:', e);
    res.status(500).json({ error: 'Erreur lors de la génération du code' });
  }
});

router.put('/agents/:id/status', requireAuth(['admin']), async (req, res) => {
  const { status } = req.body;
  const ok = await store.updateUserStatus(req.params.id, status);
  if (!ok) return res.status(404).json({ error: 'Agent non trouvé' });
  res.json({ message: 'Statut mis à jour' });
});

module.exports = router;
