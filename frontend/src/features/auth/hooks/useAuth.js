import {
  exchangeGoogleCode,
  getGoogleAuthUrl,
  loginUser,
  logoutUser,
  signupUser,
} from '@/features/auth/services/authApi';
import { useAuthStore } from '@/features/auth/store/authStore';
import Toast from '@/shared/utils/toast';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const toast = new Toast();

export function useLogin() {
  const [isLoading, setIsLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const login = async (email, password) => {
    setIsLoading(true);
    try {
      const { access_token, user } = await loginUser(email, password);
      setAuth(user, access_token);
      toast.show('success', 'Welcome back!', `Signed in as ${user.email}`);
      navigate(user.setupComplete ? '/classroom' : '/setup');
    } catch (err) {
      const message = err.response?.data?.detail || 'Invalid email or password.';
      toast.show('error', 'Login Failed', message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { login, isLoading };
}

export function useSignup() {
  const [isLoading, setIsLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const signup = async (formData) => {
    setIsLoading(true);
    try {
      const { access_token, user } = await signupUser(formData);
      setAuth(user, access_token);
      toast.show('success', 'Account Created', 'Welcome to VirtAI!');
      navigate(user.setupComplete ? '/classroom' : '/setup');
    } catch (err) {
      const message = err.response?.data?.detail || 'Could not create account.';
      toast.show('error', 'Signup Failed', message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  return { signup, isLoading };
}

export function useGoogleAuth() {
  const [isLoading, setIsLoading] = useState(false);

  const startGoogleAuth = async () => {
    setIsLoading(true);
    try {
      const url = await getGoogleAuthUrl();
      window.location.href = url;
    } catch (err) {
      toast.show('error', 'Google Auth', 'Could not connect to Google.');
      setIsLoading(false);
    }
  };

  return { startGoogleAuth, isLoading };
}

export function useGoogleCallback() {
  const [isLoading, setIsLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const handleCallback = async (code) => {
    setIsLoading(true);
    try {
      const { access_token, user } = await exchangeGoogleCode(code);
      setAuth(user, access_token);
      toast.show('success', 'Welcome!', `Signed in as ${user.email}`);
      navigate(user.setupComplete ? '/classroom' : '/setup');
    } catch (err) {
      toast.show('error', 'Auth Failed', 'Google sign-in failed.');
      navigate('/auth');
    } finally {
      setIsLoading(false);
    }
  };

  return { handleCallback, isLoading };
}

export function useRestoreSession() {
  const initAuth = useAuthStore((s) => s.initAuth);

  const restore = useCallback(async () => {
    await initAuth();
  }, [initAuth]);

  return { restore };
}

export function useLogout() {
  const storeLogout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const logout = async () => {
    try {
      await logoutUser();
    } catch {
      // ignore
    }
    storeLogout();
    navigate('/');
  };

  return { logout };
}
