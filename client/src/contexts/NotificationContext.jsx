import React, { createContext, useContext, useCallback, useReducer, useRef } from 'react';

const NotificationContext = createContext(null);

const MAX_VISIBLE = 5;
const DEDUP_MS = 600;

function reducer(state, action) {
  switch (action.type) {
    case 'ADD': {
      const isDup = state.some(n => n.message === action.payload.message && n.kind === action.payload.kind);
      if (isDup) return state;
      const next = [...state, action.payload];
      return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
    }
    case 'REMOVE':
      return state.filter(n => n.id !== action.id);
    default:
      return state;
  }
}

let _nextId = 1;

export function NotificationProvider({ children }) {
  const [notifications, dispatch] = useReducer(reducer, []);
  const recentKeys = useRef(new Map());

  const notify = useCallback((message, kind = 'success', opts = {}) => {
    const key = `${kind}:${message}`;
    const now = Date.now();
    const last = recentKeys.current.get(key);
    if (last && now - last < DEDUP_MS) return;
    recentKeys.current.set(key, now);
    // Clean up old dedup keys periodically
    if (recentKeys.current.size > 50) {
      for (const [k, t] of recentKeys.current) {
        if (now - t > 5000) recentKeys.current.delete(k);
      }
    }
    const id = _nextId++;
    const duration = opts.duration ?? (kind === 'error' ? 5000 : 4000);
    dispatch({ type: 'ADD', payload: { id, message, kind, duration } });
  }, []);

  const dismiss = useCallback((id) => {
    dispatch({ type: 'REMOVE', id });
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, notify, dismiss }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used within NotificationProvider');
  const { notify, dismiss } = ctx;
  return {
    notify,
    dismiss,
    success: (msg, opts) => notify(msg, 'success', opts),
    error:   (msg, opts) => notify(msg, 'error', opts),
    warning: (msg, opts) => notify(msg, 'warning', opts),
    info:    (msg, opts) => notify(msg, 'info', opts),
  };
}

export default NotificationContext;
