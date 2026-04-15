import apiClient from '@/shared/services/apiClient';

export async function loginUser(email, password) {
  const { data } = await apiClient.post('/auth/login', { email, password });
  return data;
}

export async function signupUser({ fullName, email, password }) {
  const { data } = await apiClient.post('/auth/signup', {
    full_name: fullName,
    email,
    password,
  });
  return data;
}

export async function getMe() {
  const { data } = await apiClient.get('/auth/me');
  return data;
}

export async function getGoogleAuthUrl() {
  const { data } = await apiClient.get('/auth/google/url');
  return data.url;
}

export async function exchangeGoogleCode(code) {
  const { data } = await apiClient.post('/auth/google/callback', { code });
  return data;
}

export async function refreshAccessToken() {
  // Use bare axios (not apiClient) to avoid the 401 interceptor
  // retrying refresh indefinitely when the refresh token itself is invalid.
  const { default: axios } = await import('axios');
  const { data } = await axios.post('/api/v1/auth/refresh', null, {
    withCredentials: true,
  });
  return data;
}

export async function logoutUser() {
  await apiClient.post('/auth/logout');
}
