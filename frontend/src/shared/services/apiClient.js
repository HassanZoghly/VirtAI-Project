import { refreshAccessTokenSingleFlight } from '@/features/auth/services/refreshService';
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
        const resData = await refreshAccessTokenSingleFlight();
        // Only update the token — never touch the user object mid-flight.
        // setAuth(store.user, token) would wipe user to null if initAuth
        // hasn't finished populating it yet (e.g. on hard page refresh).
        useAuthStore.setState({ accessToken: resData.access_token });
        original.headers.Authorization = `Bearer ${resData.access_token}`;
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
