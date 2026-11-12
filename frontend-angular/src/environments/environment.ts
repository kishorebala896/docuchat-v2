/** API base URL. The FastAPI backend runs on :8000 with CORS enabled for the
 * Angular dev origin (see backend/main.py). For a proxied setup, point this at
 * '/api' and serve with --proxy-config proxy.conf.json instead. */
export const environment = {
  production: false,
  apiUrl: 'http://localhost:8000',
};
