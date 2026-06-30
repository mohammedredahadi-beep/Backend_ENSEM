const express = require('express');
const router = express.Router();

const store = require('../services/store');
const { verifyToken, getPublicKey } = require('../services/jwt');
const { requireAuth } = require('../middleware/auth');

// ─── POST /scan/check ────────────────────────────────────────────────────────
// Étape 1 : Vérifie le token QR SANS le consommer (permet à l'agent de choisir le nb d'invités)

router.post('/check', requireAuth(['agent', 'admin']), async (req, res) => {
  try {
    const { token } = req.body;
    const agentId = req.user.sub;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!token) return res.status(400).json({ valid: false, error: 'Token requis' });

    // 1. Vérification cryptographique
    const { valid, claims, error } = verifyToken(token);
    if (!valid) {
      await store.recordScan({ laureatId: null, agentId, deviceId: req.body.device_id, action: error?.includes('expiré') ? 'expire' : 'token_invalide', ipAddress, motifRefus: error });
      return res.status(200).json({ valid: false, action: error?.includes('expiré') ? 'expire' : 'token_invalide', motif: error, color: 'red' });
    }

    const laureatId = claims.sub;
    const jti = claims.jti;

    // 2. Vérifier si déjà utilisé
    const tokenRecord = await store.getToken(jti);
    if (tokenRecord?.used) {
      await store.recordScan({ laureatId, agentId, deviceId: req.body.device_id, action: 'double_scan', ipAddress, motifRefus: 'Token déjà utilisé' });
      return res.status(200).json({ valid: false, action: 'double_scan', motif: 'Ce QR code a déjà été scanné.', color: 'red', scanned_at: tokenRecord.used_at });
    }

    // 3. Récupérer le lauréat
    const laureat = await store.getLaureatById(laureatId);
    if (!laureat) {
      return res.status(200).json({ valid: false, action: 'token_invalide', motif: 'Lauréat introuvable.', color: 'red' });
    }

    // ✅ Token valide, NON consommé → l'agent peut choisir le nb d'invités
    return res.json({
      valid: true,
      action: 'check_ok',
      color: 'blue',
      jti, // Renvoyer pour la confirmation
      laureat: { id: laureat.id, nom: laureat.nom, prenom: laureat.prenom, filiere: laureat.filiere, quota_invites: laureat.quota_invites, photo_url: laureat.photo_url },
    });
  } catch (e) {
    console.error('Check error:', e);
    res.status(500).json({ valid: false, error: 'Erreur de vérification' });
  }
});

// ─── POST /scan/validate ──────────────────────────────────────────────────────
// Étape 2 : Confirme l'entrée (consomme le token + enregistre le nb d'invités)

router.post('/validate', requireAuth(['agent', 'admin']), async (req, res) => {
  try {
    const { token, device_id, invites_count = 0 } = req.body;
    const agentId = req.user.sub;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!token) return res.status(400).json({ valid: false, error: 'Token requis' });

    // 1. Vérification cryptographique (signature RSA + expiration)
    const { valid, claims, error } = verifyToken(token);
    if (!valid) {
      const action = error?.includes('expiré') ? 'expire' : 'token_invalide';
      await store.recordScan({ laureatId: null, agentId, deviceId: device_id, action, ipAddress, motifRefus: error });
      return res.status(200).json({ valid: false, action, motif: error, color: 'red' });
    }

    const laureatId = claims.sub;
    const jti = claims.jti;

    // 2. Vérification double scan
    const tokenRecord = await store.getToken(jti);
    if (tokenRecord?.used) {
      await store.recordScan({ laureatId, agentId, deviceId: device_id, action: 'double_scan', ipAddress, motifRefus: 'Token déjà utilisé' });
      return res.status(200).json({ valid: false, action: 'double_scan', motif: 'Ce QR code a déjà été scanné.', color: 'red', scanned_at: tokenRecord.used_at });
    }

    // 3. Récupérer le lauréat
    const laureat = await store.getLaureatById(laureatId);
    if (!laureat) {
      await store.recordScan({ laureatId, agentId, deviceId: device_id, action: 'token_invalide', ipAddress, motifRefus: 'Lauréat non trouvé' });
      return res.status(200).json({ valid: false, action: 'token_invalide', motif: 'Lauréat introuvable.', color: 'red' });
    }

    // 4. Vérifier quota invités
    if (invites_count > laureat.quota_invites) {
      await store.recordScan({ laureatId, agentId, deviceId: device_id, action: 'quota_depasse', ipAddress, motifRefus: `Quota dépassé: ${invites_count} > ${laureat.quota_invites}` });
      return res.status(200).json({ valid: false, action: 'quota_depasse', motif: `Quota d'invités dépassé. Autorisé : ${laureat.quota_invites}, présenté : ${invites_count}.`, color: 'red', quota_autorise: laureat.quota_invites });
    }

    // 5. ✅ Tout est valide → consommer le token et marquer le lauréat présent
    if (tokenRecord) await store.markTokenUsed(jti, agentId);
    await store.markLaureatPresent(laureatId, invites_count);
    await store.recordScan({ laureatId, agentId, deviceId: device_id, action: 'succes', ipAddress, invites_count });

    res.json({
      valid: true,
      action: 'succes',
      color: 'green',
      laureat: { id: laureat.id, nom: laureat.nom, prenom: laureat.prenom, filiere: laureat.filiere, quota_invites: laureat.quota_invites, photo_url: laureat.photo_url },
      message: `✅ Entrée validée – ${laureat.prenom} ${laureat.nom} + ${invites_count} invité(s)`,
    });
  } catch (e) {
    console.error('Scan error:', e);
    res.status(500).json({ valid: false, error: 'Erreur de validation' });
  }
});

// ─── GET /api/scan/public-key ─────────────────────────────────────────────────

router.get('/public-key', requireAuth(['agent', 'admin']), async (req, res) => {
  res.json({ public_key: getPublicKey(), algorithm: 'RS256' });
});

// ─── GET /api/scan/audit ──────────────────────────────────────────────────────

router.get('/audit', requireAuth(['agent', 'admin']), async (req, res) => {
  const { agentId } = req.query;
  const filters = req.user.role === 'agent' ? { agentId: req.user.sub } : {};
  if (agentId && req.user.role === 'admin') filters.agentId = agentId;
  res.json(await store.getAllScans(filters));
});

module.exports = router;
