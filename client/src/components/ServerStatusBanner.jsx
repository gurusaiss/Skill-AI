import React, { useState, useEffect, useRef } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:3001');

export default function ServerStatusBanner() {
  const [status, setStatus] = useState('unknown'); // 'unknown' | 'online' | 'waking' | 'offline'
  const [visible, setVisible] = useState(false);
  const lastCheck = useRef(0);

  const check = async () => {
    // Don't hammer the server — max once per 30s
    if (Date.now() - lastCheck.current < 30000) return;
    lastCheck.current = Date.now();

    try {
      const res = await fetch(`${API_BASE_URL}/api/health`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        setStatus('online');
        setVisible(false);
      } else {
        setStatus('waking');
        setVisible(true);
      }
    } catch (_) {
      setStatus('waking');
      setVisible(true);
    }
  };

  useEffect(() => {
    check();
    // Recheck every 30s while the banner is visible
    const id = setInterval(() => {
      if (status !== 'online') check();
    }, 30000);
    return () => clearInterval(id);
  }, [status]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: '#1e293b',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '10px 16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        fontSize: '13px',
        color: '#94a3b8',
        maxWidth: '90vw',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: '16px', flexShrink: 0 }}>⏳</span>
      <span>
        <strong style={{ color: '#e2e8f0' }}>Server is waking up</strong>
        {' '}— first request may take up to 30 seconds. Your data is safe.
      </span>
      <button
        onClick={() => setVisible(false)}
        style={{
          marginLeft: '8px',
          background: 'none',
          border: 'none',
          color: '#64748b',
          cursor: 'pointer',
          fontSize: '16px',
          lineHeight: 1,
          padding: '0 2px',
          flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
