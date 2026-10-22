import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true, // send HttpOnly cookie with every request
});

function getCookie(name: string): string | null {
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  const prefix = `${name}=`;
  const matched = cookies.find(cookie => cookie.startsWith(prefix));
  return matched ? decodeURIComponent(matched.slice(prefix.length)) : null;
}

api.interceptors.request.use((config) => {
  const method = (config.method || 'get').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return config;
  const csrfToken = getCookie('erp_csrf');
  if (!csrfToken) return config;
  config.headers = config.headers ?? {};
  config.headers['X-CSRF-Token'] = csrfToken;
  return config;
});


// Auto-logout on 401 (expired/invalid token)
// Skip redirect for auth-check endpoints and when already on /login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/me');
    const isAlreadyOnLogin = window.location.pathname === '/login';
    if (error.response?.status === 401 && !isAuthEndpoint && !isAlreadyOnLogin) {
      // Session expired: come back to the same page after logging in again.
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
    return Promise.reject(error);
  }
);

export default api;
