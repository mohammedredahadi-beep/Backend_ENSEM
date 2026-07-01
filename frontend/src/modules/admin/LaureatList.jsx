import { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import './admin.css';

export default function LaureatList() {
  const [laureats, setLaureats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [search, setSearch] = useState('');
  const [editQuota, setEditQuota] = useState({});
  const [generating, setGenerating] = useState({});
  const fileRef = useRef();

  const fetchLaureats = async () => {
    try { const data = await api.admin.getLaureats(); setLaureats(data); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchLaureats(); }, []);

  const handleImport = async (file) => {
    if (!file) return;
    setImporting(true); setImportResult(null);
    try {
      const res = await api.admin.import(file);
      setImportResult(res);
      fetchLaureats();
    } catch (e) { setImportResult({ error: e.message }); }
    finally { setImporting(false); }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleImport(file);
  };

  const handleQuotaChange = async (id, val) => {
    try {
      await api.admin.updateQuota(id, val);
      setLaureats(l => l.map(x => x.id === id ? { ...x, quota_invites: val } : x));
      setEditQuota(q => ({ ...q, [id]: false }));
    } catch (e) { alert(e.message); }
  };

  const handleGeneratePass = async (id) => {
    setGenerating(g => ({ ...g, [id]: true }));
    try {
      await api.admin.generatePass(id);
      setLaureats(l => l.map(x => x.id === id ? { ...x, pass_generated: true } : x));
    } catch (e) { alert(e.message); }
    finally { setGenerating(g => ({ ...g, [id]: false })); }
  };

  const filtered = laureats.filter(l =>
    `${l.nom_complet || `${l.prenom || ''} ${l.nom || ''}`} ${l.email} ${l.filiere}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="admin-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">🎓 Lauréats</h1>
          <p className="page-subtitle">{laureats.length} lauréat(s) enregistré(s)</p>
        </div>
      </div>

      {/* Import CSV */}
      <div
        className="drop-zone card"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={(e) => handleImport(e.target.files[0])} />
        {importing ? (
          <div className="flex flex-col items-center gap-3">
            <div className="spinner spinner-lg" />
            <p>Import en cours...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div style={{ fontSize: 32 }}>📁</div>
            <p style={{ fontWeight: 600 }}>Glisser un fichier CSV/Excel ici</p>
            <p className="text-muted" style={{ fontSize: 13 }}>ou cliquer pour sélectionner</p>
            <p className="text-muted" style={{ fontSize: 11 }}>Colonnes attendues : Nom, Prénom, Email, Filière, CIN, Quota Invités</p>
          </div>
        )}
      </div>

      {importResult && (
        <div className={`alert ${importResult.error ? 'alert-error' : 'alert-success'} animate-fade-in`}>
          {importResult.error
            ? <><span>❌</span> Erreur : {importResult.error}</>
            : <><span>✅</span> Import terminé : <strong>{importResult.created}</strong> ajouté(s), {importResult.skipped} ignoré(s)</>
          }
        </div>
      )}

      {/* Search */}
      <div className="input-group">
        <input className="input" placeholder="🔍 Rechercher par nom, email, filière..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      {loading ? <div className="spinner spinner-lg" style={{ margin: '40px auto' }} /> : (
        <div className="table-wrapper">
          <table>
            <thead><tr>
              <th>Nom complet</th><th>Filière</th><th>CIN</th>
              <th>Quota invités</th><th>Pass</th><th>Présent</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="text-center text-muted" style={{ padding: '32px' }}>
                  {search ? 'Aucun résultat' : 'Aucun lauréat. Importez un fichier CSV.'}
                </td></tr>
              )}
              {filtered.map(l => (
                <tr key={l.id}>
                  <td style={{ fontWeight: 600 }}>{l.nom_complet || `${l.prenom || ''} ${l.nom || ''}`.trim()}</td>
                  <td><span className="badge badge-info">{l.filiere}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 13 }}>{l.cin || '—'}</td>
                  <td>
                    {editQuota[l.id] ? (
                      <select className="input" style={{ width: 70, padding: '4px 8px' }}
                        defaultValue={l.quota_invites}
                        onChange={(e) => handleQuotaChange(l.id, parseInt(e.target.value))}>
                        {[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    ) : (
                      <span className="badge badge-primary" style={{ cursor: 'pointer' }}
                        onClick={() => setEditQuota(q => ({ ...q, [l.id]: true }))}
                        title="Cliquer pour modifier">
                        {l.quota_invites} ✎
                      </span>
                    )}
                  </td>
                  <td>
                    {l.pass_generated
                      ? <span className="badge badge-success">✅ Généré</span>
                      : <span className="badge badge-warning">⚠️ Non généré</span>}
                  </td>
                  <td>
                    {l.present
                      ? <span className="badge badge-success">✅ Présent</span>
                      : <span className="badge badge-error">❌ Absent</span>}
                  </td>
                  <td>
                    <button className="btn btn-primary btn-sm" onClick={() => handleGeneratePass(l.id)}
                      disabled={generating[l.id]}>
                      {generating[l.id] ? '...' : '🎫 Pass'}
                    </button>
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
