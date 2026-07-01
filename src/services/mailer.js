const nodemailer = require('nodemailer');

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://ceremonie-access.web.app';
const FROM_EMAIL   = process.env.FROM_EMAIL   || 'noreply@ensem.ac.ma';
const FROM_NAME    = process.env.FROM_NAME    || 'ENSEM ACCESS';

/**
 * Crée le transporteur SMTP sécurisé pour l'envoi d'emails.
 * Variables d'environnement en production :
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE
 */
function createTransporter() {
  if (!process.env.SMTP_USER) {
    return null; // Mode dev : log console uniquement
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true', // true pour le port 465, false pour 587 ou autre
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Envoie un email en utilisant SMTP sécurisé (Nodemailer) ou log console en mode dev.
 */
async function sendEmail({ to, subject, html }) {
  const transporter = createTransporter();

  if (!transporter) {
    // ── Mode dev : affichage console ──
    console.log('\n📧 ══════════════════════════════════════');
    console.log(`   À       : ${to}`);
    console.log(`   Sujet   : ${subject}`);
    console.log(`   Contenu : ${html.replace(/<[^>]+>/g, '').slice(0, 200)}...`);
    console.log('══════════════════════════════════════\n');
    return { dev: true };
  }

  // ── Mode production : envoi réel via SMTP ──
  try {
    const info = await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    });
    console.log(`✅ Email envoyé à ${to} — MessageId: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`❌ Erreur envoi email à ${to}:`, err.message);
    throw err;
  }
}

// ─── Templates emails ─────────────────────────────────────────────────────────

async function sendEmailVerification(user, token) {
  const link = `${FRONTEND_URL}/auth/verify-email/${token}`;
  return sendEmail({
    to: user.email,
    subject: '✅ ENSEM ACCESS – Vérifiez votre adresse email',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e3a5f;">Bienvenue sur ENSEM ACCESS</h2>
        <p>Bonjour ${user.prenom || user.nom_complet || ''} ${user.nom || ''},</p>
        <p>Merci pour votre inscription. Veuillez confirmer votre adresse email en cliquant sur le bouton ci-dessous :</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${link}" style="background: #d4a017; color: white; padding: 14px 28px;
             border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
            Vérifier mon email
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">Ce lien expire dans 24 heures.</p>
        <p style="color: #666; font-size: 14px;">Si vous n'avez pas créé de compte, ignorez cet email.</p>
        <hr>
        <p style="color: #999; font-size: 12px;">ENSEM ACCESS – Système de gestion d'accès cérémonie de remise des diplômes</p>
      </div>
    `,
  });
}

async function sendAccountApproved(user, laureat) {
  const passLink = `${FRONTEND_URL}/pass`;
  return sendEmail({
    to: user.email,
    subject: '🎓 ENSEM ACCESS – Votre accès a été validé !',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e3a5f;">Votre accès est confirmé !</h2>
        <p>Bonjour ${user.prenom || user.nom_complet || ''} ${user.nom || ''},</p>
        <p>Nous avons le plaisir de vous confirmer que votre inscription a été validée par l'administration de l'ENSEM.</p>
        <div style="background: #f0f7ff; border-left: 4px solid #1e3a5f; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0;"><strong>Filière :</strong> ${laureat.filiere}</p>
          <p style="margin: 8px 0 0;"><strong>Invités autorisés :</strong> ${laureat.quota_invites} personne(s)</p>
        </div>
        <p>Votre pass digital est désormais disponible. Présentez le QR code à l'entrée le jour de la cérémonie.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${passLink}" style="background: #d4a017; color: white; padding: 14px 28px;
             border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
            Accéder à mon pass
          </a>
        </div>
        <p style="color: #e53e3e; font-size: 14px;"><strong>Important :</strong> Le QR code se régénère toutes les 2 minutes. Ne partagez pas de captures d'écran.</p>
        <hr>
        <p style="color: #999; font-size: 12px;">ENSEM ACCESS – Cérémonie de remise des diplômes</p>
      </div>
    `,
  });
}

async function sendAccountRejected(user, motif) {
  return sendEmail({
    to: user.email,
    subject: '❌ ENSEM ACCESS – Votre inscription n\'a pas pu être validée',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #c53030;">Inscription non validée</h2>
        <p>Bonjour ${user.prenom || user.nom_complet || ''} ${user.nom || ''},</p>
        <p>Après vérification, nous n'avons pas pu valider votre inscription pour la cérémonie de remise des diplômes.</p>
        ${motif ? `<div style="background: #fff5f5; border-left: 4px solid #c53030; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0;"><strong>Motif :</strong> ${motif}</p>
        </div>` : ''}
        <p>Pour toute réclamation, veuillez contacter l'administration de l'ENSEM.</p>
        <hr>
        <p style="color: #999; font-size: 12px;">ENSEM ACCESS – Cérémonie de remise des diplômes</p>
      </div>
    `,
  });
}

async function sendAgentInvite(email, inviteCode, adminNom) {
  const registerLink = `${FRONTEND_URL}/auth/register?role=agent&code=${inviteCode}`;
  return sendEmail({
    to: email,
    subject: '🔐 ENSEM ACCESS – Invitation Agent de Contrôle',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1e3a5f;">Invitation Agent ENSEM ACCESS</h2>
        <p>Vous avez été invité(e) par <strong>${adminNom}</strong> à rejoindre ENSEM ACCESS en tant qu'agent de contrôle.</p>
        <div style="background: #f0f7ff; border-left: 4px solid #1e3a5f; padding: 16px; margin: 20px 0; border-radius: 4px;">
          <p style="margin: 0;"><strong>Code d'invitation :</strong> <code style="font-size: 18px; color: #d4a017;">${inviteCode}</code></p>
        </div>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${registerLink}" style="background: #1e3a5f; color: white; padding: 14px 28px;
             border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
            Créer mon compte agent
          </a>
        </div>
        <p style="color: #666; font-size: 14px;">Ce code est à usage unique et expire après utilisation.</p>
        <hr>
        <p style="color: #999; font-size: 12px;">ENSEM ACCESS – Système de contrôle d'accès</p>
      </div>
    `,
  });
}

module.exports = { sendEmailVerification, sendAccountApproved, sendAccountRejected, sendAgentInvite };
