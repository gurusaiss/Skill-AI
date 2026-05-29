// Determine API base URL based on environment
const getApiBaseUrl = () => {
  if (import.meta.env.PROD) return '';
  return 'http://localhost:3001';
};

const API_BASE_URL = getApiBaseUrl();

const getAuthHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const request = async (path, options = {}) => {
  let response;
  const fullUrl = `${API_BASE_URL}${path}`;

  try {
    response = await fetch(fullUrl, {
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(60000),
      ...options,
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
    const errorBody = payload?.error;
    const errorMessage = typeof errorBody === 'string'
      ? errorBody
      : (errorBody?.message || errorBody?.detail || `Request failed with status ${response.status}.`);
    throw new Error(errorMessage);
  }

  if (!payload) {
    throw new Error('Server returned an empty response.');
  }

  if (payload.success === false) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload.data;
};

const fileRequest = async (path, formData) => {
  let response;
  const fullUrl = `${API_BASE_URL}${path}`;

  try {
    response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        ...getAuthHeaders(),
      },
      body: formData,
      signal: AbortSignal.timeout(120000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('File upload timed out. Please try with a smaller file or check your connection.');
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
    const errorBody = payload?.error;
    const errorMessage = typeof errorBody === 'string'
      ? errorBody
      : (errorBody?.message || errorBody?.detail || `Request failed with status ${response.status}.`);
    throw new Error(errorMessage);
  }

  if (!payload) {
    throw new Error('Server returned an empty response.');
  }

  return payload.data;
};

// Helper to safely convert objects to display strings
const safeString = (obj) => {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) return obj.map(safeString).join(', ');
  if (typeof obj === 'object') {
    if (obj.name) return obj.name;
    if (obj.title) return obj.title;
    if (obj.label) return obj.label;
    return JSON.stringify(obj);
  }
  return String(obj);
};

export const api = {
  // Core flow
  createGoal: (body) => {
    if (body.jobDescriptionFile) {
      const formData = new FormData();
      formData.append('goalText', body.goalText);
      formData.append('jobDescriptionFile', body.jobDescriptionFile);
      return fileRequest('/api/goal', formData);
    }
    return request('/api/goal', { method: 'POST', body: JSON.stringify({ goalText: body.goalText }) });
  },
  submitDiagnostic: (body) => request('/api/diagnostic/submit', { method: 'POST', body: JSON.stringify(body) }),
  getDashboard: (userId) => request(`/api/session/dashboard/${userId}`),
  getChallenge: (userId, day) => request(`/api/session/challenge/${userId}/${day}`),
  submitSession: (body) => request('/api/session/submit', { method: 'POST', body: JSON.stringify(body) }),
  generateReport: (userId) => request('/api/report/generate', { method: 'POST', body: JSON.stringify({ userId }) }),
  getReport: (userId) => request(`/api/report/${userId}`),
  getGoal: (userId) => request(`/api/goal/${userId}`),

  // Simulation
  runWhatIf: (body) => request('/api/simulation/whatif', { method: 'POST', body: JSON.stringify(body) }),
  comparePaths: (body) => request('/api/simulation/compare', { method: 'POST', body: JSON.stringify(body) }),
  getForecast: (userId) => request(`/api/simulation/forecast/${userId}`),

  // Market Intelligence
  getMarketIntel: (userId) => request(`/api/market/intelligence/${userId}`),
  getMarketTrends: (domain) => request(`/api/market/trends/${domain}`),

  // Assessment Management
  getAssessments: () => request('/api/assessment'),
  createAssessment: (body) => request('/api/assessment', { method: 'POST', body: JSON.stringify(body) }),
  updateAssessment: (id, body) => request(`/api/assessment/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAssessment: (id) => request(`/api/assessment/${id}`, { method: 'DELETE' }),
  getUserAssessments: (userId) => request(`/api/assessment/user/${userId}`),
  submitAssessment: (id, body) => request(`/api/assessment/${id}/submit`, { method: 'POST', body: JSON.stringify(body) }),
  generateInterviewQuestions: (body) => request('/api/interview/generate', { method: 'POST', body: JSON.stringify(body) }),
  evaluateInterviewAnswer: (body) => request('/api/interview/evaluate', { method: 'POST', body: JSON.stringify(body) }),
  generateInterviewReport: (body) => request('/api/interview/report', { method: 'POST', body: JSON.stringify(body) }),

  // Session Quiz & Notes
  generateSessionQuiz: (body) => request('/api/session/quiz', { method: 'POST', body: JSON.stringify(body) }),
  generateNotes: (body) => request('/api/session/notes', { method: 'POST', body: JSON.stringify(body) }),

  // Content Management (NEW)
  getPackages: (filters) => {
    let url = '/api/content/packages';
    const params = new URLSearchParams();
    if (filters?.category) params.set('category', filters.category);
    if (filters?.type) params.set('type', filters.type);
    if (filters?.difficulty) params.set('difficulty', filters.difficulty);
    if (params.toString()) url += `?${params.toString()}`;
    return request(url);
  },
  createPackage: (body) => request('/api/content/packages', { method: 'POST', body: JSON.stringify(body) }),
  updatePackage: (id, body) => request(`/api/content/packages/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePackage: (id) => request(`/api/content/packages/${id}`, { method: 'DELETE' }),

  // Skill Packages (NEW)
  getSkillPackages: (filters) => {
    let url = '/api/content/skill-packages';
    const params = new URLSearchParams();
    if (filters?.domain) params.set('domain', filters.domain);
    if (filters?.difficulty) params.set('difficulty', filters.difficulty);
    if (params.toString()) url += `?${params.toString()}`;
    return request(url);
  },
  createSkillPackage: (body) => request('/api/content/skill-packages', { method: 'POST', body: JSON.stringify(body) }),
  updateSkillPackage: (id, body) => request(`/api/content/skill-packages/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  // Learning Tracks (NEW)
  getLearningTracks: (filters) => {
    let url = '/api/content/learning-tracks';
    const params = new URLSearchParams();
    if (filters?.track_type) params.set('track_type', filters.track_type);
    if (filters?.difficulty) params.set('difficulty', filters.difficulty);
    if (params.toString()) url += `?${params.toString()}`;
    return request(url);
  },
  createLearningTrack: (body) => request('/api/content/learning-tracks', { method: 'POST', body: JSON.stringify(body) }),

  // Groups
  getGroups: () => request('/api/content/groups'),
  createGroup: (body) => request('/api/content/groups', { method: 'POST', body: JSON.stringify(body) }),
  addGroupMembers: (groupId, body) => request(`/api/content/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify(body) }),

  // Assignments (NEW)
  getAssignments: (filters) => {
    let url = '/api/assignments';
    const params = new URLSearchParams();
    if (filters?.userId) params.set('userId', filters.userId);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.type) params.set('type', filters.type);
    if (params.toString()) url += `?${params.toString()}`;
    return request(url);
  },
  getAssignmentDashboard: () => request('/api/assignments/dashboard'),
  createAssignment: (body) => request('/api/assignments/content', { method: 'POST', body: JSON.stringify(body) }),
  updateAssignment: (id, body) => request(`/api/assignments/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  getModules: (filters = {}) => {
    let url = '/api/modules';
    const params = new URLSearchParams();
    if (filters?.category) params.set('category', filters.category);
    if (filters?.difficulty) params.set('difficulty', filters.difficulty);
    if (filters?.limit) params.set('limit', filters.limit);
    if (filters?.offset) params.set('offset', filters.offset);
    if (params.toString()) url += `?${params.toString()}`;
    return request(url);
  },
  createModule: (body) => request('/api/modules', { method: 'POST', body: JSON.stringify(body) }),
  updateModule: (id, body) => request(`/api/modules/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteModule: (id) => request(`/api/modules/${id}`, { method: 'DELETE' }),

  // Users
  getUsers: () => request('/api/users'),
  updateUser: (id, body) => request(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  getUserRoles: () => ['admin', 'manager', 'employee'],

  // Health
  getHealth: () => request('/api/health'),

  // AI Tutor
  tutorChat: (message, context, history = []) =>
    request('/api/tutor/chat', {
      method: 'POST',
      body: JSON.stringify({ message, context, history }),
    }),

  // ReAct Agent Chain
  runReactChain: (goal, sessions, skills, planDay) =>
    request('/api/react/run', {
      method: 'POST',
      body: JSON.stringify({ goal, sessions, skills, planDay }),
    }),
  getReactDemo: () => request('/api/react/demo'),
};

export { safeString };

export function scoreColor(score) {
  if (score >= 75) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}