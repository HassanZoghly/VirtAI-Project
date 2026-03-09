import { useAuthStore } from '@/features/auth/store/authStore';
import axios from 'axios';

const apiClient = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const res = await axios.post('/api/v1/auth/refresh', null, {
          withCredentials: true,
        });
        const store = useAuthStore.getState();
        store.setAuth(store.user, res.data.access_token);
        original.headers.Authorization = `Bearer ${res.data.access_token}`;
        return apiClient(original);
      } catch {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
