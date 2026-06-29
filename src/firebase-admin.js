const admin = require('firebase-admin');

// Initialize the Firebase Admin SDK
if (!admin.apps.length) {
  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      credential = admin.credential.cert(serviceAccount);
    } catch (e) {
      console.error("Erreur de parsing de FIREBASE_SERVICE_ACCOUNT:", e);
    }
  }

  admin.initializeApp({
    credential: credential || admin.credential.applicationDefault()
  });
}

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
