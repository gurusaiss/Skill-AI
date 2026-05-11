// Determine API base URL based on environment
const getApiBaseUrl = () => {
  // In production (Vercel), use relative URLs
  if (import.meta.env.PROD) {
    return '';
  }
  // In development, use localhost
  return 'http://localhost:3001';
};

const API_BASE_URL = getApiBaseUrl();

const request = async (path, options = {}) => {
  let response;
  const fullUrl = `${API_BASE_URL}${path}`;

  try {
    response = await fetch(fullUrl, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(60000), // 60s timeout for Gemini calls
      ...options
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Request timed out. The AI is taking too long — please try again.');
    }
    throw new Error('Could not reach the app server. Make sure the frontend and backend are both running.');
  }

  const rawBody = await response.text();
  let payload = null;

  if (rawBody) {
    try {
      payload = JSON.parse(rawBody);
    } catch (_error) {
      throw new Error(`Server returned a non-JSON response (${response.status}). Make sure the backend is running on port 3001.`);
    }
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with status ${response.status}.`);
  }

  if (!payload) {
    throw new Error('Server returned an empty response.');
  }

  if (payload.success === false) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload.data;
};

export const api = {
  // Core flow
  createGoal:       (body)         => request('/api/goal', { method: 'POST', body: JSON.stringify(body) }),
  submitDiagnostic: (body)         => request('/api/diagnostic/submit', { method: 'POST', body: JSON.stringify(body) }),
  getDashboard:     (userId)       => request(`/api/session/dashboard/${userId}`),
  getChallenge:     (userId, day)  => request(`/api/session/challenge/${userId}/${day}`),
  submitSession:    (body)         => request('/api/session/submit', { method: 'POST', body: JSON.stringify(body) }),
  generateReport:   (userId)       => request('/api/report/generate', { method: 'POST', body: JSON.stringify({ userId }) }),
  getReport:        (userId)       => request(`/api/report/${userId}`),
  getGoal:          (userId)       => request(`/api/goal/${userId}`),

  // Simulation
  runWhatIf:        (body)         => request('/api/simulation/whatif', { method: 'POST', body: JSON.stringify(body) }),
  comparePaths:     (body)         => request('/api/simulation/compare', { method: 'POST', body: JSON.stringify(body) }),
  getForecast:      (userId)       => request(`/api/simulation/forecast/${userId}`),

  // Market Intelligence
  getMarketIntel:   (userId)       => request(`/api/market/intelligence/${userId}`),
  getMarketTrends:  (domain)       => request(`/api/market/trends/${domain}`),

  // Interview Simulator
  generateInterviewQuestions: (body) => request('/api/interview/generate', { method: 'POST', body: JSON.stringify(body) }),
  evaluateInterviewAnswer:    (body) => request('/api/interview/evaluate', { method: 'POST', body: JSON.stringify(body) }),
  generateInterviewReport:    (body) => request('/api/interview/report',   { method: 'POST', body: JSON.stringify(body) }),

  // Session Quiz & Notes
  generateSessionQuiz: (body)     => request('/api/session/quiz', { method: 'POST', body: JSON.stringify(body) }),
  generateNotes:       (body)     => request('/api/session/notes', { method: 'POST', body: JSON.stringify(body) }),

  // Health
  getHealth:        ()             => request('/api/health'),
};

export const scoreColor = (score) => {
  if (score >= 75) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
};
