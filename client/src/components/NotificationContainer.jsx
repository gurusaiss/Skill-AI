import React, { useEffect, useState, useContext } from 'react';
import NotificationContext from '../contexts/NotificationContext.jsx';

const CFG = {
  success: {
    icon: '✓',
    iconBg: 'bg-emerald-500/20',
    iconColor: 'text-emerald-300',
    border: 'border-emerald-500/30',
    bar: 'bg-emerald-500',
    text: 'text-emerald-100',
  },
  error: {
    icon: '✕',
    iconBg: 'bg-red-500/20',
    iconColor: 'text-red-300',
    border: 'border-red-500/30',
    bar: 'bg-red-500',
    text: 'text-red-100',
  },
  warning: {
    icon: '⚠',
    iconBg: 'bg-amber-500/20',
    iconColor: 'text-amber-300',
    border: 'border-amber-500/30',
    bar: 'bg-amber-500',
    text: 'text-amber-100',
  },
  info: {
    icon: 'ℹ',
    iconBg: 'bg-indigo-500/20',
    iconColor: 'text-indigo-300',
    border: 'border-indigo-500/30',
    bar: 'bg-indigo-500',
    text: 'text-indigo-100',
  },
};

function NotificationItem({ notification, onDismiss }) {
  const { id, message, kind, duration } = notification;
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const cfg = CFG[kind] || CFG.info;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(pct);
      if (pct <= 0) {
        handleDismiss();
        return;
      }
      timer = requestAnimationFrame(tick);
    };
    let timer = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(timer);
  }, [duration]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => onDismiss(id), 280);
  };

  return (
    <div
      className={`relative overflow-hidden rounded-xl border shadow-2xl backdrop-blur-xl transition-all ease-out max-w-md w-full
        bg-slate-900/95 ${cfg.border}
        ${visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
      style={{ transitionDuration: '220ms' }}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className={`shrink-0 w-7 h-7 rounded-lg ${cfg.iconBg} flex items-center justify-center mt-0.5`}>
          <span className={`text-sm font-bold leading-none ${cfg.iconColor}`}>{cfg.icon}</span>
        </div>
        <p className={`flex-1 text-base font-medium leading-snug ${cfg.text} py-0.5`}>{message}</p>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-slate-400 hover:text-slate-200 transition-colors text-base leading-none mt-0.5 ml-1"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <div className="h-0.5 bg-slate-700/60">
        <div
          className={`h-full ${cfg.bar} opacity-70 transition-none`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export default function NotificationContainer() {
  const ctx = useContext(NotificationContext);
  if (!ctx) return null;
  const { notifications, dismiss } = ctx;
  if (!notifications.length) return null;

  return (
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center pointer-events-none"
      style={{ width: 'min(100vw - 2rem, 480px)' }}
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      {notifications.map(n => (
        <div key={n.id} className="pointer-events-auto w-full">
          <NotificationItem notification={n} onDismiss={dismiss} />
        </div>
      ))}
    </div>
  );
}
