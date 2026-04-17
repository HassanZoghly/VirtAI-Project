import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  user: null,
  accessToken: null,
  isAuthenticated: false,
  isLoading: true,

  setAuth: (user, accessToken) =>
    set({ user, accessToken, isAuthenticated: true, isLoading: false }),

  setUser: (user) =>
    set((state) => ({
      ...state,
      user,
      isAuthenticated: !!user,
    })),

  logout: () => set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false }),

  setLoading: (isLoading) => set({ isLoading }),

  initAuth: async () => {
    set({ isLoading: true });
    try {
      const { getMe, refreshAccessToken } = await import('../services/authApi');
      const { access_token } = await refreshAccessToken();

      set((state) => ({ ...state, accessToken: access_token, isAuthenticated: true }));
      const user = await getMe();
      set({ user, accessToken: access_token, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
