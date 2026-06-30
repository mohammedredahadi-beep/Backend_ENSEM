const { auth, db } = require('../firebase-admin');

/**
 * Middleware d'authentification Firebase Auth.
 * Vérifie le token ID, puis récupère le rôle depuis Firestore.
 */
function requireAuth(roles = []) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentification requise' });
    }
    
    const token = authHeader.split(' ')[1];
    try {
      // 1. Vérification du token Firebase
      const decodedToken = await auth.verifyIdToken(token);
      
      // 2. Récupération des détails (rôle) depuis Firestore
      const doc = await db.collection('users').doc(decodedToken.uid).get();
      let userData = { role: 'laureate', status: 'actif' }; // defaults
      if (doc.exists) {
        userData = doc.data();
      }

      const user = {
        sub: decodedToken.uid,
        email: decodedToken.email,
        email_verified: decodedToken.email_verified,
        role: userData.role,
        status: userData.status,
      };

      // Vérifier que l'email est confirmé (sauf pour les routes auth)
      if (!user.email_verified && !req.path.includes('/verify-email')) {
        return res.status(403).json({ error: 'Email non vérifié. Vérifiez votre boîte mail.' });
      }

      if (roles.length > 0 && !roles.includes(user.role)) {
        return res.status(403).json({ error: 'Accès refusé : rôle insuffisant' });
      }

      req.user = user;
      next();
    } catch (err) {
      console.error('Token verification error:', err);
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }
  };
}

module.exports = { requireAuth };
