import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter as Router } from 'react-router-dom';
import AuthProvider from './AuthProvider';

const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

export default function AppProviders({ children }) {
  return (
    <HelmetProvider>
      <AuthProvider>
        <Router future={ROUTER_FUTURE}>
          {children}
        </Router>
      </AuthProvider>
    </HelmetProvider>
  );
}
