import { useState, useEffect, useRef, useCallback } from 'react';
import jsQR from 'jsqr';
import api from '../../services/api';
import { useAuth } from '../../services/AuthContext';
import './scanner.css';

function ResultPanel({ result, onConfirm, onReset, invitesCount, setInvitesCount }) {
  if (!result) return null;

  const isValid = result.valid;

  return (
    <div className={`result-panel ${isValid ? 'valid' : 'invalid'} animate-scale-in`}>
      <div className="result-icon">{isValid ? '✅' : '❌'}</div>

      {isValid ? (
        <>
          <h2 className="result-title">Accès Autorisé</h2>
          <div className="result-laureate">
            <div className="result-photo">
              {result.laureat?.photo_url
                ? <img src={result.laureat.photo_url} alt="" />
                : <div className="result-photo-placeholder">
                    <svg viewBox="0 0 60 60" fill="none">
                      <circle cx="30" cy="22" r="10" fill="rgba(255,255,255,0.3)" />
                      <ellipse cx="30" cy="48" rx="18" ry="12" fill="rgba(255,255,255,0.2)" />
                    </svg>
                  </div>
              }
            </div>
            <div>
              <div className="result-name">{result.laureat?.prenom} {result.laureat?.nom}</div>
              <div className="result-filiere">{result.laureat?.filiere}</div>
            </div>
          </div>

          {/* Invités counter */}
          <div className="invites-counter">
            <p>Nombre d'invités accompagnant le lauréat :</p>
            <div className="counter-controls">
              <button className="btn btn-secondary btn-icon" onClick={() => setInvitesCount(Math.max(0, invitesCount - 1))}>−</button>
              <span className="counter-value">{invitesCount}</span>
              <button className="btn btn-secondary btn-icon" onClick={() => setInvitesCount(Math.min(result.laureat?.quota_invites || 4, invitesCount + 1))}>+</button>
            </div>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
              Quota autorisé : {result.laureat?.quota_invites} invité(s)
            </p>
          </div>

          <button className="btn btn-success btn-lg w-full" onClick={onConfirm}>
            ✅ Valider l'entrée du groupe ({1 + invitesCount} personne{1 + invitesCount > 1 ? 's' : ''})
          </button>
        </>
      ) : (
        <>
          <h2 className="result-title">Accès Refusé</h2>
          <div className="result-motif">
            <p>{result.motif || 'Token invalide'}</p>
            {result.scanned_at && (
              <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                Déjà scanné le {new Date(result.scanned_at).toLocaleString('fr-FR')}
              </p>
            )}
          </div>
        </>
      )}

      <button className="btn btn-secondary w-full" style={{ marginTop: 12 }} onClick={onReset}>
        🔄 Scanner suivant
      </button>
    </div>
  );
}

export default function Scanner() {
  const { user } = useAuth();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animRef = useRef(null);

  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);      // Résultat du /check (non consommé)
  const [confirmed, setConfirmed] = useState(false); // true après /validate
  const [validating, setValidating] = useState(false);
  const [invitesCount, setInvitesCount] = useState(0);
  const [pendingToken, setPendingToken] = useState(null); // Token original conservé pour /validate
  const [auditLog, setAuditLog] = useState([]);
  const [cameraError, setCameraError] = useState('');
  const [deviceId] = useState(() => {
    let id = localStorage.getItem('agent_device_id');
    if (!id) { id = 'device-' + Math.random().toString(36).slice(2); localStorage.setItem('agent_device_id', id); }
    return id;
  });

  const stopCamera = useCallback(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setScanning(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanning(true);
      }
    } catch (e) {
      setCameraError('Impossible d\'accéder à la caméra : ' + e.message);
    }
  }, []);

  // Scan loop
  useEffect(() => {
    if (!scanning || result) return;
    const tick = () => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video.readyState !== video.HAVE_ENOUGH_DATA) { animRef.current = requestAnimationFrame(tick); return; }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
      if (code?.data) {
        handleQRDetected(code.data);
        return;
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [scanning, result]);

  // Étape 1 : vérification sans consommer le token
  const handleQRDetected = useCallback(async (token) => {
    if (validating) return;
    setValidating(true);
    stopCamera();
    setPendingToken(token); // Conserver le token pour l'étape 2
    try {
      const res = await api.scan.check(token, deviceId);
      setResult(res);
      setInvitesCount(0);
      if (!res.valid) {
        setAuditLog(prev => [{ ...res, time: new Date().toISOString() }, ...prev.slice(0, 19)]);
      }
    } catch (e) {
      setResult({ valid: false, motif: 'Erreur réseau : ' + e.message });
    } finally { setValidating(false); }
  }, [validating, deviceId, stopCamera]);

  // Étape 2 : confirmation avec le nombre d'invités → consomme le token
  const handleConfirmEntry = useCallback(async () => {
    if (!result?.valid || !pendingToken) return;
    setValidating(true);
    try {
      const res = await api.scan.validate(pendingToken, invitesCount, deviceId);
      setAuditLog(prev => [{ ...res, time: new Date().toISOString() }, ...prev.slice(0, 19)]);
      setConfirmed(true);
      setTimeout(handleReset, 2500);
    } catch (e) {
      setResult({ valid: false, motif: 'Erreur confirmation : ' + e.message });
    } finally { setValidating(false); }
  }, [result, pendingToken, invitesCount, deviceId]);

  const handleReset = useCallback(() => {
    setResult(null);
    setConfirmed(false);
    setPendingToken(null);
    setInvitesCount(0);
    startCamera();
  }, [startCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  return (
    <div className="scanner-page">
      {/* Header */}
      <div className="scanner-header">
        <img src="/logo_ensem.png" alt="ENSEM" style={{ height: 32, filter: 'drop-shadow(0 0 8px rgba(212,160,23,0.4))' }} />
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--color-gold)' }}>
            ENSEM ACCESS
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-dim)' }}>Agent de Contrôle</div>
        </div>
        <div className={`scanner-status-badge ${scanning ? 'active' : 'inactive'}`}>
          <span className="live-dot" style={{ background: scanning ? 'var(--color-success)' : 'var(--color-text-dim)' }} />
          {scanning ? 'Scan actif' : 'En attente'}
        </div>
      </div>

      {/* Camera / Result area */}
      <div className="scanner-main">
        {!result ? (
          <div className="camera-area">
            <div className="camera-viewport">
              <video ref={videoRef} playsInline muted className="camera-video" />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              {scanning && (
                <div className="scan-overlay">
                  <div className="scan-frame">
                    <div className="scan-corner tl" /><div className="scan-corner tr" />
                    <div className="scan-corner bl" /><div className="scan-corner br" />
                    <div className="scan-line" />
                  </div>
                </div>
              )}
              {!scanning && !cameraError && (
                <div className="camera-placeholder">
                  <div style={{ fontSize: 48 }}>📷</div>
                  <p>Caméra arrêtée</p>
                </div>
              )}
              {cameraError && (
                <div className="camera-placeholder">
                  <div style={{ fontSize: 32 }}>⚠️</div>
                  <p style={{ fontSize: 13 }}>{cameraError}</p>
                </div>
              )}
            </div>

            <div className="camera-controls">
              {!scanning ? (
                <button className="btn btn-primary btn-lg" onClick={startCamera}>
                  📷 Démarrer le scan
                </button>
              ) : (
                <button className="btn btn-secondary btn-lg" onClick={stopCamera}>
                  ⏹ Arrêter
                </button>
              )}
              {validating && (
                <div className="flex items-center gap-3" style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>
                  <span className="spinner" /> Validation en cours...
                </div>
              )}
            </div>
          </div>
        ) : (
          <ResultPanel result={result} onConfirm={handleConfirmEntry} onReset={handleReset}
            invitesCount={invitesCount} setInvitesCount={setInvitesCount} />
        )}
      </div>

      {/* Audit log */}
      {auditLog.length > 0 && (
        <div className="audit-panel">
          <h3 className="section-title" style={{ marginBottom: 12 }}>📋 Journal des scans récents</h3>
          <div className="audit-list">
            {auditLog.map((entry, i) => (
              <div key={i} className={`audit-entry ${entry.valid ? 'success' : 'fail'}`}>
                <span className="audit-icon">{entry.valid ? '✅' : '❌'}</span>
                <div className="audit-info">
                  <span className="audit-name">
                    {entry.valid ? `${entry.laureat?.prenom} ${entry.laureat?.nom}` : (entry.action || entry.motif || 'Refusé')}
                  </span>
                  <span className="audit-time">{new Date(entry.time).toLocaleTimeString('fr-FR')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
