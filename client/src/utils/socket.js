import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.PROD ? '' : 'http://localhost:3001';

let socket = null;

export function getSocket(userId) {
  if (!socket) {
    socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      auth: { userId },
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => console.log('[socket] connected', socket.id));
    socket.on('disconnect', (reason) => console.log('[socket] disconnected', reason));
    socket.on('connect_error', (err) => console.warn('[socket] error', err.message));
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/** Subscribe to agent progress events during goal processing */
export function onAgentProgress(handler) {
  const s = getSocket();
  s.on('agent:progress', handler);
  return () => s.off('agent:progress', handler);
}

/** Subscribe to session completion events */
export function onSessionComplete(sessionId, handler) {
  const s = getSocket();
  s.emit('subscribe:session', sessionId);
  s.on('session:completed', handler);
  return () => {
    s.off('session:completed', handler);
  };
}
