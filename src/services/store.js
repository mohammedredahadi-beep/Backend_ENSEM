const { v4: uuidv4 } = require('uuid');
const { db } = require('../firebase-admin');

async function createUser(userData) {
  const userRef = db.collection('users').doc(userData.id || uuidv4());
  await userRef.set({
    ...userData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return (await userRef.get()).data();
}

async function getUserById(id) {
  const doc = await db.collection('users').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function getUserByEmail(email) {
  const snapshot = await db.collection('users').where('email', '==', email.toLowerCase().trim()).limit(1).get();
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

async function getUserByCIN(cin) {
  if (!cin) return null;
  const snapshot = await db.collection('users').where('cin', '==', cin.toUpperCase().trim()).limit(1).get();
  return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

async function updateUserStatus(userId, status) {
  const userDoc = await db.collection('users').doc(userId).get();
  const updates = {
    status,
    updated_at: new Date().toISOString()
  };
  if (status === 'actif' && userDoc.exists) {
    const userData = userDoc.data();
    if (userData.role === 'laureate') {
      updates.profil_complete = false;
    }
  }
  await db.collection('users').doc(userId).update(updates);
  return true;
}

async function verifyUserEmail(userId) {
  await db.collection('users').doc(userId).update({
    email_verified: true,
    status: 'email_verifie',
    updated_at: new Date().toISOString()
  });
  return true;
}

async function getAllPendingUsers() {
  const snapshot = await db.collection('users')
    .where('status', 'in', ['email_verifie', 'email_non_verifie'])
    .where('role', '==', 'laureate')
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getAllUsers(filters = {}) {
  let query = db.collection('users');
  if (filters.role) query = query.where('role', '==', filters.role);
  if (filters.status) query = query.where('status', '==', filters.status);
  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function createLaureat(laureatData) {
  const id = uuidv4();
  const data = {
    ...laureatData,
    id,
    email: laureatData.email.toLowerCase().trim(),
    cin: laureatData.cin ? laureatData.cin.toUpperCase().trim() : null,
    pass_generated: false,
    present: false,
    invites_entres: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db.collection('laureats').doc(id).set(data);
  return data;
}

async function getLaureatById(id) {
  const doc = await db.collection('laureats').doc(id).get();
  return doc.exists ? doc.data() : null;
}

async function getLaureatByUserId(userId) {
  const snapshot = await db.collection('laureats').where('user_id', '==', userId).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function getLaureatByEmail(email) {
  const snapshot = await db.collection('laureats').where('email', '==', email.toLowerCase().trim()).limit(1).get();
  if (snapshot.empty) return null;
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function linkUserToLaureat(laureatId, userId) {
  await db.collection('laureats').doc(laureatId).update({
    user_id: userId,
    updated_at: new Date().toISOString(),
  });
  return true;
}

async function getAllLaureats(filters = {}) {
  let query = db.collection('laureats');
  if (filters.filiere) query = query.where('filiere', '==', filters.filiere);
  if (filters.present !== undefined) query = query.where('present', '==', filters.present);
  const snapshot = await query.get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getAbsentLaureats() {
  const snapshot = await db.collection('laureats').where('present', '==', false).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function updateLaureatQuota(id, quota) {
  await db.collection('laureats').doc(id).update({
    quota_invites: parseInt(quota, 10),
    updated_at: new Date().toISOString()
  });
  return true;
}

async function markLaureatPresent(laureatId, invitesCount = 0) {
  await db.collection('laureats').doc(laureatId).update({
    present: true,
    invites_entres: invitesCount,
    updated_at: new Date().toISOString()
  });
  return true;
}

async function setLaureatPassGenerated(id, value = true) {
  await db.collection('laureats').doc(id).update({ pass_generated: value });
  return true;
}

async function searchLaureatsByName(queryStr) {
  const q = queryStr.toLowerCase();
  const snapshot = await db.collection('laureats').get();
  return snapshot.docs.map(doc => doc.data()).filter(l => l.nom.toLowerCase().includes(q) || l.prenom.toLowerCase().includes(q));
}

async function registerToken(jti, laureatId, expiresAt) {
  await db.collection('tokens').doc(jti).set({
    jti, laureat_id: laureatId, expires_at: expiresAt,
    used: false, used_at: null, used_by_agent: null,
    created_at: new Date().toISOString()
  });
}

async function getToken(jti) {
  const doc = await db.collection('tokens').doc(jti).get();
  return doc.exists ? doc.data() : null;
}

async function markTokenUsed(jti, agentId) {
  await db.collection('tokens').doc(jti).update({
    used: true, used_at: new Date().toISOString(), used_by_agent: agentId
  });
  return true;
}

async function getAllActiveTokens() {
  const now = Math.floor(Date.now() / 1000);
  const snapshot = await db.collection('tokens').where('used', '==', false).where('expires_at', '>', now).get();
  return snapshot.docs.map(doc => doc.data());
}

async function recordScan(scanData) {
  const id = uuidv4();
  const data = {
    ...scanData, id, timestamp: new Date().toISOString()
  };
  await db.collection('scans').doc(id).set(data);
  return data;
}

async function getAllScans(filters = {}) {
  let query = db.collection('scans').orderBy('timestamp', 'desc');
  if (filters.laureatId) query = query.where('laureatId', '==', filters.laureatId);
  if (filters.agentId) query = query.where('agentId', '==', filters.agentId);
  if (filters.action) query = query.where('action', '==', filters.action);
  const snapshot = await query.get();
  
  const scans = snapshot.docs.map(doc => doc.data());
  
  // Joindre les détails des lauréats et des agents
  const enrichedScans = await Promise.all(scans.map(async (scan) => {
    let laureatName = 'Inconnu';
    let agentName = 'Système / Admin';

    if (scan.laureatId) {
      const laureatDoc = await db.collection('laureats').doc(scan.laureatId).get();
      if (laureatDoc.exists) {
        const l = laureatDoc.data();
        laureatName = `🎓 ${l.prenom} ${l.nom}`;
      }
    }

    if (scan.agentId) {
      const agentDoc = await db.collection('users').doc(scan.agentId).get();
      if (agentDoc.exists) {
        const a = agentDoc.data();
        agentName = `👤 ${a.prenom} ${a.nom}`;
      }
    }

    return {
      ...scan,
      laureat_name: laureatName,
      agent_name: agentName
    };
  }));

  return enrichedScans;
}

async function getRecentScans(limitNum = 50) {
  const snapshot = await db.collection('scans').orderBy('timestamp', 'desc').limit(limitNum).get();
  return snapshot.docs.map(doc => doc.data());
}

async function getStats() {
  const laureatsSnap = await db.collection('laureats').get();
  const laureats = laureatsSnap.docs.map(doc => doc.data());
  const totalLaureats = laureats.length;
  const presents = laureats.filter(l => l.present).length;
  const totalInvitesAutorises = laureats.reduce((s, l) => s + l.quota_invites, 0);
  const totalInvitesEntres = laureats.reduce((s, l) => s + l.invites_entres, 0);

  const scansSnap = await db.collection('scans').get();
  const scans = scansSnap.docs.map(doc => doc.data());
  const alertes = scans.filter(s => s.action !== 'succes');
  const scansRecents = scans.filter(s => new Date(s.timestamp) > new Date(Date.now() - 60000));

  const pendingUsersSnap = await db.collection('users').where('status', '==', 'email_verifie').get();
  
  return {
    laureats: { total: totalLaureats, presents, absents: totalLaureats - presents },
    invites: { entres: totalInvitesEntres, total: totalInvitesAutorises },
    scans: { total: scans.length, alertes: alertes.length, par_minute: scansRecents.length },
    comptes_en_attente: pendingUsersSnap.empty ? 0 : pendingUsersSnap.size,
    timestamp: new Date().toISOString(),
  };
}

async function createInviteCode(adminId, email) {
  const code = uuidv4().slice(0, 8).toUpperCase();
  await db.collection('inviteCodes').doc(code).set({ 
    code,
    email: email.toLowerCase().trim(),
    used: false, 
    admin_id: adminId, 
    created_at: new Date().toISOString() 
  });
  return code;
}

async function useInviteCode(code, email, agentId) {
  const doc = await db.collection('inviteCodes').doc(code).get();
  if (!doc.exists) return false;
  const data = doc.data();
  if (data.used || data.email !== email.toLowerCase().trim()) return false;
  
  // Expiration au bout de 5 minutes (300 secondes)
  const elapsed = (Date.now() - new Date(data.created_at).getTime()) / 1000;
  if (elapsed > 300) return false;

  await db.collection('inviteCodes').doc(code).update({ 
    used: true, 
    agent_id: agentId, 
    used_at: new Date().toISOString() 
  });
  return true;
}

async function isInviteCodeValid(code, email) {
  const doc = await db.collection('inviteCodes').doc(code).get();
  if (!doc.exists) return false;
  const data = doc.data();
  if (data.used || data.email !== email.toLowerCase().trim()) return false;
  
  const elapsed = (Date.now() - new Date(data.created_at).getTime()) / 1000;
  return elapsed <= 300;
}

async function isEmailAuthorized(email) {
  const snapshot = await db.collection('laureats').where('email', '==', email.toLowerCase().trim()).limit(1).get();
  return !snapshot.empty;
}

async function completeLaureatProfile(userId, updates) {
  // 1. Mettre à jour l'utilisateur pour indiquer que son profil est complété
  await db.collection('users').doc(userId).update({
    profil_complete: true,
    telephone: updates.telephone || '',
    updated_at: new Date().toISOString()
  });

  // 2. Mettre à jour les informations du lauréat lié (qui a été corrigé)
  const laureatSnapshot = await db.collection('laureats').where('user_id', '==', userId).limit(1).get();
  if (!laureatSnapshot.empty) {
    const laureatId = laureatSnapshot.docs[0].id;
    await db.collection('laureats').doc(laureatId).update({
      nom: updates.nom.trim(),
      prenom: updates.prenom.trim(),
      cin: updates.cin.toUpperCase().trim(),
      filiere: updates.filiere,
      telephone: updates.telephone || '',
      quota_invites: parseInt(updates.quota_invites, 10),
      updated_at: new Date().toISOString()
    });
  }
  return true;
}

async function bulkImportLaureats(rows) {
  const results = { created: 0, skipped: 0, errors: [] };
  for (const row of rows) {
    try {
      if (!row.nom || !row.prenom || !row.email) {
        results.errors.push({ row, reason: 'Champs obligatoires manquants' });
        results.skipped++;
        continue;
      }
      const existing = await getLaureatByEmail(row.email);
      if (existing) {
        results.skipped++;
        continue;
      }
      await createLaureat({
        nom: row.nom, prenom: row.prenom, email: row.email,
        filiere: row.filiere || 'Non spécifiée',
        cin: row.cin || null,
        quota_invites: parseInt(row.quota_invites, 10) || 2,
        photo_url: null,
      });
      results.created++;
    } catch (e) {
      results.errors.push({ row, reason: e.message });
    }
  }
  return results;
}

module.exports = {
  createUser, getUserById, getUserByEmail, getUserByCIN, updateUserStatus, verifyUserEmail, getAllPendingUsers, getAllUsers,
  createLaureat, getLaureatById, getLaureatByUserId, getLaureatByEmail, linkUserToLaureat, getAllLaureats, updateLaureatQuota, markLaureatPresent, setLaureatPassGenerated, searchLaureatsByName, bulkImportLaureats,
  registerToken, getToken, markTokenUsed, getAllActiveTokens,
  recordScan, getAllScans, getRecentScans,
  getStats,
  createInviteCode, useInviteCode, isInviteCodeValid,
  isEmailAuthorized, completeLaureatProfile, getAbsentLaureats
};
