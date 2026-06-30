import { useState, useEffect } from 'react';
import api from '../../services/api';
import './admin.css';

export default function AgentList() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);

  const fetchAgents = async () => {
    try { const data = await api.admin.getAgents(); setAgents(data); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAgents(); }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviting(true); setInviteResult(null);
    try {
      const res = await api.admin.inviteAgent(inviteEmail);
      setInviteResult({ success: true, code: res.code, message: res.message });
      setInviteEmail('');
    } catch (err) {
      setInviteResult({ success: false, message: err.message });
    } finally { setInviting(false); }
  };

  const handleStatusChange = async (id, status) => {
    try {
      await api.admin.updateAgentStatus(id, status);
      setAgents(a => a.map(x => x.id === id ? { ...x, status } : x));
    } catch (e) { alert('Erreur : ' + e.message); }
  };

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">🔐 Agents de contrôle</h1>
          <p className="page-subtitle">{agents.length} agent(s) enregistré(s)</p>
        </div>
      </div>

      {/* Invite Agent */}
      <div className="card card-gold animate-fade-in">
        <h3 className="section-title">➕ Inviter un nouvel agent</h3>
        <form onSubmit={handleInvite} style={{ display: 'flex', gap: 12 }}>
          <input className="input" type="email" placeholder="Email de l'agent..."
            value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} style={{ flex: 1 }} />
          <button type="submit" className="btn btn-primary" disabled={inviting || !inviteEmail}>
            {inviting ? '...' : '📧 Envoyer invitation'}
          </button>
        </form>
        {inviteResult && (
          <div className={`alert ${inviteResult.success ? 'alert-success' : 'alert-error'} mt-4`}>
            {inviteResult.success
              ? <><span>✅</span>{inviteResult.message} · Code : <code style={{ color: 'var(--color-gold)', fontWeight: 700 }}>{inviteResult.code}</code></>
              : <><span>❌</span>{inviteResult.message}</>}
          </div>
        )}
      </div>

      {/* Agents table */}
      {loading ? <div className="spinner spinner-lg" style={{ margin: '40px auto' }} /> : (
        <div className="table-wrapper">
          <table>
            <thead><tr>
              <th>Nom</th><th>Email</th><th>Statut</th><th>Inscrit le</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {agents.length === 0 && (
                <tr><td colSpan={5} className="text-center text-muted" style={{ padding: '32px' }}>
                  Aucun agent. Envoyez des invitations ci-dessus.
                </td></tr>
              )}
              {agents.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.prenom} {a.nom}</td>
                  <td>{a.email}</td>
                  <td>
                    <span className={`badge badge-${a.status === 'actif' ? 'success' : a.status === 'rejete' ? 'error' : 'warning'}`}>
                      {a.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    {new Date(a.created_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td>
                    {a.status !== 'actif' && (
                      <button className="btn btn-success btn-sm" onClick={() => handleStatusChange(a.id, 'actif')}>Activer</button>
                    )}
                    {a.status === 'actif' && (
                      <button className="btn btn-danger btn-sm" onClick={() => handleStatusChange(a.id, 'suspendu')}>Suspendre</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
