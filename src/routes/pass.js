const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');

const store = require('../services/store');
const { generatePassToken, getPublicKey } = require('../services/jwt');
const { requireAuth } = require('../middleware/auth');

// ─── GET /api/pass/my-pass ────────────────────────────────────────────────────
// Récupère le pass du lauréat connecté avec un QR code fraîchement généré (anti-screenshot)

router.get('/my-pass', requireAuth(['laureate']), async async (req, res) => {
  try {
    const  = await store.(req.user.sub);
    if (!laureat) {
      return res.status(404).json({ error: 'Aucun pass trouvé. Votre compte est peut-être en attente de validation.' });
    }

    // Génère un nouveau JWT de courte durée (120s) à chaque requête
    const token = generatePassToken(laureat, 120);
    const parts = token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // Enregistrer le JTI (pour tracking et invalidation)
    await store.(claims.jti, laureat.id, claims.exp);

    // Générer l'image QR
    const qrDataUrl = await QRCode.toDataURL(token, {
      errorCorrectionLevel: 'H',
      margin: 2,
      width: 300,
      color: { dark: '#1e3a5f', light: '#ffffff' },
    });

    res.json({
      laureat: {
        nom: laureat.nom,
        prenom: laureat.prenom,
        filiere: laureat.filiere,
        quota_invites: laureat.quota_invites,
        photo_url: laureat.photo_url,
      },
      token,
      qr_data_url: qrDataUrl,
      expires_at: claims.exp,
      jti: claims.jti,
    });
  } catch (e) {
    console.error('Pass error:', e);
    res.status(500).json({ error: 'Erreur de génération du pass' });
  }
});

// ─── GET /api/pass/public-key ─────────────────────────────────────────────────
// Retourne la clé publique RSA pour vérification offline par les agents

router.get('/public-key', async (req, res) => {
  res.json({ public_key: getPublicKey(), algorithm: 'RS256' });
});

module.exports = router;
