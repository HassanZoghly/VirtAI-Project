import { create } from 'zustand';

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
    set({ isLoading: true });
    try {
      const { getMe, refreshAccessToken } = await import('../services/authApi');
      const { access_token } = await refreshAccessToken();

      set((state) => ({ ...state, accessToken: access_token }));
      const user = await getMe();
      set({ user, accessToken: access_token, isLoading: false });
    } catch {
      set({ user: null, accessToken: null, isLoading: false });
    }
  },
}));

export const selectIsAuthenticated = (state) => !!state.user && !!state.accessToken;
