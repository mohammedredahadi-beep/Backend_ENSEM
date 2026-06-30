const express = require('express');
const router = express.Router();

const store = require('../services/store');
const { verifyToken, getPublicKey } = require('../services/jwt');
const { requireAuth } = require('../middleware/auth');

// ─── POST /api/scan/validate ──────────────────────────────────────────────────
// Validation complète d'un QR code par un agent

router.post('/validate', requireAuth(['agent', 'admin']), async (req, res) => {
  try {
    const { token, device_id } = req.body;
    const agentId = req.user.sub;
    const ipAddress = req.ip || req.connection.remoteAddress;

    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token requis' });
    }

    // 1. Vérification cryptographique (signature RSA + expiration)
    const { valid, claims, error } = verifyToken(token);

    if (!valid) {
      const action = error?.includes('expiré') ? 'expire' : 'token_invalide';
      await store.recordScan({ laureatId: null, agentId, deviceId: device_id, action, ipAddress, motifRefus: error });
      return res.status(200).json({
        valid: false,
        action,
        motif: error,
        color: 'red',
      });
    }

    const laureatId = claims.sub;
    const jti = claims.jti;

    // 2. Vérification double scan
    const tokenRecord = await store.getToken(jti);
    if (tokenRecord && tokenRecord.used) {
      await store.recordScan({ laureatId, agentId, deviceId: device_id, action: 'double_scan', ipAddress, motifRefus: 'Token déjà utilisé' });
      return res.status(200).json({
        valid: false,
        action: 'double_scan',
        motif: 'Ce QR code a déjà été scanné.',
        color: 'red',
        scanned_at: tokenRecord.used_at,
      });
    }

    // 3. Récupérer le lauréat
    const laureat = await store.getLaureatById(laureatId);
    if (!laureat) {
      await store.recordScan({ laureatId, agentId, deviceId: device_id, action: 'token_invalide', ipAddress, motifRefus: 'Lauréat non trouvé' });
      return res.status(200).json({ valid: false, action: 'token_invalide', motif: 'Lauréat introuvable.', color: 'red' });
    }

    // 4. Vérifier quota invités (si demandé)
    const { invites_count = 0 } = req.body;
    if (invites_count > laureat.quota_invites) {
      await store.recordScan({ laureatId, agentId, deviceId: device_id, action: 'quota_depasse', ipAddress, motifRefus: `Quota dépassé: ${invites_count} > ${laureat.quota_invites}` });
      return res.status(200).json({
        valid: false,
        action: 'quota_depasse',
        motif: `Quota d'invités dépassé. Autorisé : ${laureat.quota_invites}, présenté : ${invites_count}.`,
        color: 'red',
        quota_autorise: laureat.quota_invites,
      });
    }

    // 5. ✅ Tout est valide → marquer le token comme utilisé
    if (tokenRecord) {
      await store.markTokenUsed(jti, agentId);
    }
    await store.markLaureatPresent(laureatId, invites_count);
    await store.recordScan({ laureatId, agentId, deviceId: device_id, action: 'succes', ipAddress });

    res.json({
      valid: true,
      action: 'succes',
      color: 'green',
      laureat: {
        id: laureat.id,
        nom: laureat.nom,
        prenom: laureat.prenom,
        filiere: laureat.filiere,
        quota_invites: laureat.quota_invites,
        photo_url: laureat.photo_url,
      },
      message: `✅ Entrée validée – ${laureat.prenom} ${laureat.nom} + ${laureat.quota_invites} invité(s)`,
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
