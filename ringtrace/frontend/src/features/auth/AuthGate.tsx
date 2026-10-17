import React from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { AuthPage } from './AuthPage';
import './auth.css';

/** Renders the login/registration screen until a Supabase session exists. */
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-splash" role="status" aria-label="Checking session">
        <Loader2 size={28} className="auth-spin" />
      </div>
    );
  }

  return session ? <>{children}</> : <AuthPage />;
};

export default AuthGate;
