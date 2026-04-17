import { create } from 'zustand';
import { getMe } from '../services/authApi';
import { refreshAccessTokenSingleFlight } from '../services/refreshService';

let initAuthPromise = null;

export const useAuthStore = create((set) => ({
  user: null,
  accessToken: null,
  isLoading: true,

  setAuth: (user, accessToken) =>
    set({ user, accessToken, isLoading: false }),

  setUser: (user) =>
    set((state) => ({
      ...state,
      user,
    })),

  logout: () => set({ user: null, accessToken: null, isLoading: false }),

  setLoading: (isLoading) => set({ isLoading }),

  initAuth: async () => {
    if (initAuthPromise) {
      return initAuthPromise;
    }

    initAuthPromise = (async () => {
      set({ isLoading: true });
      try {
        const { access_token } = await refreshAccessTokenSingleFlight();

        set((state) => ({ ...state, accessToken: access_token }));
        const user = await getMe();
        set({ user, accessToken: access_token, isLoading: false });
      } catch {
        set({ user: null, accessToken: null, isLoading: false });
      }
    })().finally(() => {
      initAuthPromise = null;
    });

    return initAuthPromise;
  },
}));

export const selectIsAuthenticated = (state) => !!state.user && !!state.accessToken;
