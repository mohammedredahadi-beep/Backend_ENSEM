/**
 * ENSEM ACCESS – Détection de doublons
 *
 * 3 niveaux de détection :
 * 1. CIN exact → Rejet immédiat
 * 2. Email exact (normalisé) → Rejet immédiat
 * 3. Nom + Prénom similaires (Jaro-Winkler ≥ 0.85) → Alerte admin
 */

const { getUserByEmail, getUserByCIN, getAllUsers, getAllLaureats } = require('./store');

/**
 * Distance de Jaro-Winkler entre deux chaînes.
 * Retourne un score entre 0 (aucune ressemblance) et 1 (identique).
 */
function jaroWinkler(s1, s2) {
  if (!s1 || !s2) return 0;
  s1 = s1.toLowerCase().trim();
  s2 = s2.toLowerCase().trim();
  if (s1 === s2) return 1;

  const range = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);
  let matchingChars = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - range);
    const end = Math.min(i + range + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matchingChars++;
      break;
    }
  }

  if (matchingChars === 0) return 0;

  const s1Matched = s1.split('').filter((_, i) => s1Matches[i]);
  const s2Matched = s2.split('').filter((_, i) => s2Matches[i]);
  for (let i = 0; i < matchingChars; i++) {
    if (s1Matched[i] !== s2Matched[i]) transpositions++;
  }

  const jaro = (matchingChars / s1.length + matchingChars / s2.length +
    (matchingChars - transpositions / 2) / matchingChars) / 3;

  // Préfixe commun (max 4 caractères) → boost Winkler
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Similarité combinée Nom + Prénom.
 */
function nameSimilarity(nom1, prenom1, nom2, prenom2) {
  return (jaroWinkler(nom1, nom2) + jaroWinkler(prenom1, prenom2)) / 2;
}

/**
 * Vérifie les doublons pour un nouvel utilisateur.
 *
 * @returns {object} { hasDuplicate, type, message, similarUsers }
 *   - type: 'exact_cin' | 'exact_email' | 'fuzzy_name' | null
 */
async function checkDuplicates({ cin, email, nom, prenom }) {
  // 1. Vérification CIN exact
  if (cin) {
    const existing = await getUserByCIN(cin);
    if (existing) {
      return {
        hasDuplicate: true,
        type: 'exact_cin',
        message: 'Un compte avec ce numéro CIN existe déjà.',
        similarUsers: [],
      };
    }
  }

  // 2. Vérification email exact
  if (email) {
    const existing = await getUserByEmail(email);
    if (existing) {
      return {
        hasDuplicate: true,
        type: 'exact_email',
        message: 'Un compte avec cet email existe déjà.',
        similarUsers: [],
      };
    }
  }

  // 3. Vérification fuzzy sur nom + prénom
  const similarUsers = [];
  if (nom && prenom) {
    const allUsers = await getAllUsers();
    for (const user of allUsers) {
      if (user.role === 'admin') continue;
      const score = nameSimilarity(nom, prenom, user.nom, user.prenom);
      if (score >= 0.85) {
        similarUsers.push({
          id: user.id,
          nom: user.nom,
          prenom: user.prenom,
          email: user.email,
          score: Math.round(score * 100),
        });
      }
    }

    // Aussi vérifier dans les lauréats importés via CSV
    const allLaureats = await getAllLaureats();
    for (const l of allLaureats) {
      const score = nameSimilarity(nom, prenom, l.nom, l.prenom);
      if (score >= 0.85) {
        const alreadyInList = similarUsers.some(u => u.email === l.email);
        if (!alreadyInList) {
          similarUsers.push({
            id: l.id,
            nom: l.nom,
            prenom: l.prenom,
            email: l.email,
            score: Math.round(score * 100),
            source: 'csv',
          });
        }
      }
    }
  }

  if (similarUsers.length > 0) {
    return {
      hasDuplicate: false, // Non bloquant, juste une alerte
      type: 'fuzzy_name',
      message: `Nom similaire détecté (${similarUsers.length} correspondance(s)). Validation admin requise.`,
      similarUsers,
    };
  }

  return { hasDuplicate: false, type: null, message: null, similarUsers: [] };
}

/**
 * Vérifie si un lauréat importé via CSV correspond à un compte utilisateur.
 * Utilisé par l'admin lors de la validation.
 */
function matchUserToLaureat(user, laureats) {
  let bestMatch = null;
  let bestScore = 0;

  for (const l of laureats) {
    // Correspondance email exacte (prioritaire)
    if (l.email === user.email) return { laureat: l, score: 100, match_type: 'exact_email' };

    // Correspondance CIN
    if (user.cin && l.cin && user.cin === l.cin) {
      return { laureat: l, score: 99, match_type: 'exact_cin' };
    }

    // Fuzzy nom + prénom
    const score = nameSimilarity(user.nom, user.prenom, l.nom, l.prenom);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = l;
    }
  }

  if (bestScore >= 0.8) {
    return { laureat: bestMatch, score: Math.round(bestScore * 100), match_type: 'fuzzy_name' };
  }

  return { laureat: null, score: 0, match_type: 'none' };
}

module.exports = { checkDuplicates, matchUserToLaureat, jaroWinkler, nameSimilarity };
