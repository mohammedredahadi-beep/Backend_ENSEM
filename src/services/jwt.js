const { generateKeyPairSync, createSign, createVerify } = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYS_DIR = path.join(__dirname, '..', '..', 'keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

let privateKey = null;
let publicKey = null;

/**
 * Initialise ou charge la paire de clés RSA 2048-bit.
 * Si les clés n'existent pas, elles sont générées automatiquement.
 */
async function initKeys() {
  // ─── Priorité 1 : Variables d'environnement (Production / Render) ───────────
  if (process.env.PRIVATE_KEY && process.env.PUBLIC_KEY) {
    privateKey = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
    publicKey = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');
    console.log('🔑 Clés RSA chargées depuis les variables d\'environnement.');
    return;
  }

  // ─── Priorité 2 : Disque local (Développement) ──────────────────────────────
  if (!fs.existsSync(KEYS_DIR)) fs.mkdirSync(KEYS_DIR, { recursive: true });

  if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
    privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    publicKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
    console.log('🔑 Clés RSA chargées depuis le disque (dev local).');
  } else {
    console.log('🔑 Génération d\'une nouvelle paire de clés RSA 2048-bit...');
    const { privateKey: priv, publicKey: pub } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    privateKey = priv;
    publicKey = pub;
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey);
    console.log('✅ Clés RSA générées et sauvegardées.');
    // Afficher les clés pour les copier dans les env vars Render
    console.log('\n⚠️  IMPORTANT: Copiez ces clés dans vos variables d\'environnement Render:');
    console.log('PRIVATE_KEY=', privateKey.replace(/\n/g, '\\n'));
    console.log('PUBLIC_KEY=', publicKey.replace(/\n/g, '\\n'));
  }
}

/**
 * Génère un JWT RS256 pour un lauréat.
 * @param {object} payload - Données du lauréat
 * @param {number} expiresInSeconds - Durée de validité du token QR (défaut: 120s)
 */
function generatePassToken(payload, expiresInSeconds = 120) {
  const { v4: uuidv4 } = require('uuid');
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: 'ensem-access',
    sub: payload.id,
    jti: uuidv4(),
    iat: now,
    exp: now + expiresInSeconds,
    nom: payload.nom,
    prenom: payload.prenom,
    filiere: payload.filiere,
    quota: payload.quota_invites,
    photo: payload.photo_url || null,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const message = `${headerB64}.${claimsB64}`;

  const sign = createSign('RSA-SHA256');
  sign.update(message);
  const signature = sign.sign(privateKey, 'base64url');

  return `${message}.${signature}`;
}

/**
 * Génère un JWT de session (longue durée) pour l'auth utilisateur.
 */
function generateSessionToken(payload, expiresInSeconds = 86400) {
  const { v4: uuidv4 } = require('uuid');
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: 'ensem-access',
    sub: payload.id,
    jti: uuidv4(),
    iat: now,
    exp: now + expiresInSeconds,
    role: payload.role,
    email: payload.email,
    nom: payload.nom,
    prenom: payload.prenom,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const message = `${headerB64}.${claimsB64}`;

  const sign = createSign('RSA-SHA256');
  sign.update(message);
  const signature = sign.sign(privateKey, 'base64url');

  return `${message}.${signature}`;
}

/**
 * Vérifie et décode un JWT RS256.
 * @returns {{ valid: boolean, claims?: object, error?: string }}
 */
function verifyToken(token) {
  try {
    if (!token || typeof token !== 'string') return { valid: false, error: 'Token manquant' };
    const parts = token.split('.');
    if (parts.length !== 3) return { valid: false, error: 'Format JWT invalide' };

    const [headerB64, claimsB64, signatureB64] = parts;
    const message = `${headerB64}.${claimsB64}`;

    const verify = createVerify('RSA-SHA256');
    verify.update(message);
    const isValid = verify.verify(publicKey, signatureB64, 'base64url');

    if (!isValid) return { valid: false, error: 'Signature RSA invalide' };

    const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);

    if (claims.exp < now) return { valid: false, error: 'Token expiré', claims };
    if (claims.iss !== 'ensem-access') return { valid: false, error: 'Émetteur invalide' };

    return { valid: true, claims };
  } catch (e) {
    return { valid: false, error: `Erreur de vérification: ${e.message}` };
  }
}

/**
 * Retourne la clé publique PEM (distribuée aux scanners offline).
 */
function getPublicKey() {
  return publicKey;
}

module.exports = { initKeys, generatePassToken, generateSessionToken, verifyToken, getPublicKey };
