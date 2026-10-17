import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, ImageIcon, Loader2, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { signIn, signUp, USERNAME_PATTERN, EMAIL_PATTERN } from './authService';
import { isSupabaseConfigured } from '../../lib/supabase';
import './auth.css';

/**
 * Replace with an imported asset (e.g. `import hero from '../../assets/hero.jpg'`)
 * to swap the illustrated placeholder for a real image.
 */
const HERO_IMAGE_SRC: string | null = null;

type Mode = 'login' | 'register';

interface RegisterForm {
  name: string;
  surname: string;
  username: string;
  email: string;
  workId: string;
  password: string;
  confirmPassword: string;
}

const emptyRegister: RegisterForm = {
  name: '',
  surname: '',
  username: '',
  email: '',
  workId: '',
  password: '',
  confirmPassword: '',
};

const SpynexLogo: React.FC = () => (
  <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M16 2.5 28 9.25v13.5L16 29.5 4 22.75V9.25L16 2.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M4 9.25 16 16l12-6.75M16 16v13.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M10 5.9 22 12.6M22 5.9 10 12.6" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" opacity="0.55" />
  </svg>
);

const passwordStrength = (pw: string) => {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score] };
};

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  autoComplete: string;
  onChange: (v: string) => void;
}

const PasswordField: React.FC<PasswordFieldProps> = ({ id, label, value, placeholder, autoComplete, onChange }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="auth-input-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          required
        />
        <button
          type="button"
          id={`${id}-toggle`}
          className="auth-eye"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
};

export const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [reg, setReg] = useState<RegisterForm>(emptyRegister);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const strength = useMemo(() => passwordStrength(reg.password), [reg.password]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const updateReg = (key: keyof RegisterForm) => (value: string) =>
    setReg((prev) => ({ ...prev, [key]: value }));

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!loginIdentifier.trim() || !loginPassword) {
      setError('Enter your username or email, and password.');
      return;
    }
    setSubmitting(true);
    try {
      await signIn(loginIdentifier, loginPassword);
      // AuthProvider picks up the new session and renders the workspace
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const username = reg.username.trim().toLowerCase();
    const email = reg.email.trim();

    if (!reg.name.trim() || !reg.surname.trim()) return setError('Enter your first name and surname.');
    if (!USERNAME_PATTERN.test(username))
      return setError('Username must be 3–32 characters: letters, numbers, dot, dash or underscore.');
    if (!email || !EMAIL_PATTERN.test(email))
      return setError('Please enter a valid email address.');
    if (!reg.workId.trim()) return setError('Enter your Work ID.');
    if (reg.password.length < 8) return setError('Password must be at least 8 characters.');
    if (reg.password !== reg.confirmPassword) return setError('Passwords do not match.');

    setSubmitting(true);
    try {
      const { session } = await signUp({
        name: reg.name,
        surname: reg.surname,
        username,
        email,
        workId: reg.workId,
        password: reg.password,
      });

      if (!session) {
        // Email confirmation is enabled on the Supabase project
        setNotice('Account created! If email confirmation is enabled, please verify your email before logging in.');
        setLoginIdentifier(email);
        setReg(emptyRegister);
        setMode('login');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <header className="auth-header">
        <div className="auth-brand">
          <span className="auth-brand-mark"><SpynexLogo /></span>
          <div>
            <div className="auth-brand-name">SPYNEX</div>
            <div className="auth-brand-tag">Financial Intelligence</div>
          </div>
        </div>
        <span className="auth-header-meta">Financial investigation workspace</span>
      </header>

      <main className="auth-stage">
        <section className="auth-hero" aria-label="Workspace showcase">
          {HERO_IMAGE_SRC ? (
            <img className="auth-hero-img" src={HERO_IMAGE_SRC} alt="SPYNEX workspace" />
          ) : (
            <div className="auth-hero-placeholder" aria-hidden="true">
              <div className="auth-sun" />
              <div className="auth-mountain auth-mountain--left" />
              <div className="auth-mountain auth-mountain--right" />
              <div className="auth-hill auth-hill--back" />
              <div className="auth-hill auth-hill--front" />
            </div>
          )}
          <div className="auth-hero-label">
            <ImageIcon size={11} />
            <span>Image placeholder</span>
          </div>
          <div className="auth-hero-caption">
            <h2>A clearer view of every connection.</h2>
            <p>Reserved for landscape image</p>
          </div>
        </section>

        <section className="auth-card" aria-live="polite">
          <div key={mode} className={`auth-card-inner${mode === 'register' ? ' auth-card-inner--register' : ''}`}>
            <span className="auth-eyebrow">SPYNEX Workspace</span>
            <h1 className="auth-title">{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
            <p className="auth-subtitle">
              {mode === 'login'
                ? 'Log in to continue your investigation.'
                : 'Register to access the investigation workspace.'}
            </p>

            {!isSupabaseConfigured && (
              <div className="auth-alert auth-alert--warn" role="alert">
                <AlertCircle size={14} />
                <span>Supabase is not configured. Add keys to <code>.env.local</code>.</span>
              </div>
            )}
            {error && (
              <div className="auth-alert auth-alert--error" role="alert">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}
            {notice && (
              <div className="auth-alert auth-alert--success" role="status">
                <CheckCircle2 size={14} />
                <span>{notice}</span>
              </div>
            )}

            {mode === 'login' ? (
              <form className="auth-form" onSubmit={handleLogin} noValidate>
                <div className="auth-field">
                  <label htmlFor="login-identifier">Username or Email</label>
                  <input
                    id="login-identifier"
                    type="text"
                    value={loginIdentifier}
                    placeholder="Enter your username or email"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    required
                  />
                </div>
                <PasswordField
                  id="login-password"
                  label="Password"
                  value={loginPassword}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  onChange={setLoginPassword}
                />
                <button id="login-submit" type="submit" className="auth-submit" disabled={submitting}>
                  {submitting ? <Loader2 size={16} className="auth-spin" /> : <span>Log in</span>}
                </button>
              </form>
            ) : (
              <form className="auth-form" onSubmit={handleRegister} noValidate>
                <div className="auth-row">
                  <div className="auth-field">
                    <label htmlFor="register-name">Name</label>
                    <input
                      id="register-name"
                      type="text"
                      value={reg.name}
                      placeholder="First name"
                      autoComplete="given-name"
                      onChange={(e) => updateReg('name')(e.target.value)}
                      required
                    />
                  </div>
                  <div className="auth-field">
                    <label htmlFor="register-surname">Surname</label>
                    <input
                      id="register-surname"
                      type="text"
                      value={reg.surname}
                      placeholder="Last name"
                      autoComplete="family-name"
                      onChange={(e) => updateReg('surname')(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="auth-row">
                  <div className="auth-field">
                    <label htmlFor="register-username">Username</label>
                    <input
                      id="register-username"
                      type="text"
                      value={reg.username}
                      placeholder="Choose a username"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      onChange={(e) => updateReg('username')(e.target.value)}
                      required
                    />
                  </div>
                  <div className="auth-field">
                    <label htmlFor="register-workid">Work ID</label>
                    <input
                      id="register-workid"
                      type="text"
                      value={reg.workId}
                      placeholder="Work ID"
                      autoComplete="off"
                      onChange={(e) => updateReg('workId')(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="auth-field">
                  <label htmlFor="register-email">Email</label>
                  <input
                    id="register-email"
                    type="email"
                    value={reg.email}
                    placeholder="Enter your work email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => updateReg('email')(e.target.value)}
                    required
                  />
                </div>

                <PasswordField
                  id="register-password"
                  label="Create password"
                  value={reg.password}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  onChange={updateReg('password')}
                />
                {reg.password && (
                  <div className="auth-strength" data-score={strength.score}>
                    <div className="auth-strength-bars">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className={i < strength.score ? 'is-on' : ''} />
                      ))}
                    </div>
                    <span className="auth-strength-label">{strength.label}</span>
                  </div>
                )}
                <PasswordField
                  id="register-confirm-password"
                  label="Confirm password"
                  value={reg.confirmPassword}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  onChange={updateReg('confirmPassword')}
                />
                <button id="register-submit" type="submit" className="auth-submit" disabled={submitting}>
                  {submitting ? <Loader2 size={16} className="auth-spin" /> : <span>Create account</span>}
                </button>
              </form>
            )}

            <div className="auth-switch">
              {mode === 'login' ? (
                <>
                  <span>New to SPYNEX?</span>
                  <button id="goto-register" type="button" onClick={() => switchMode('register')}>
                    Create an account <ArrowRight size={13} />
                  </button>
                </>
              ) : (
                <>
                  <span>Already have an account?</span>
                  <button id="goto-login" type="button" onClick={() => switchMode('login')}>
                    Log in <ArrowRight size={13} />
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="auth-footer">
        <span>SPYNEX · Financial intelligence, connected.</span>
        <span>Authorized workspace access only.</span>
      </footer>
    </div>
  );
};

export default AuthPage;
