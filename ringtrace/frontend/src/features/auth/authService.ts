import { supabase, isSupabaseConfigured } from '../../lib/supabase';

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeUsername = (username: string) => username.trim().toLowerCase();

export interface RegisterPayload {
  name: string;
  surname: string;
  username: string;
  email: string;
  workId: string;
  password: string;
}

const ensureConfigured = () => {
  if (!isSupabaseConfigured) {
    throw new Error('Authentication service is not configured. Contact your administrator.');
  }
};

const friendlyError = (error: any): string => {
  const message = error?.message || String(error);
  console.error('[Supabase Auth Error Details]:', error);
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Incorrect username/email or password.';
  if (m.includes('user already registered') || m.includes('already exists')) return 'An account with this email is already registered.';
  if (m.includes('database error saving new user') || m.includes('duplicate key')) return 'This username or Work ID is already registered.';
  if (m.includes('email not confirmed')) return 'Account pending email confirmation. Please check your inbox or disable email confirmation in Supabase.';
  if (m.includes('password should be')) return 'Password must be at least 8 characters.';
  if (m.includes('rate limit') || m.includes('too many') || error?.status === 429) {
    return `Supabase Rate Limit: ${message}. The cooldown window may take a few minutes to reset in Supabase, or increase your limit in Dashboard > Authentication > Rate Limits.`;
  }
  if (m.includes('failed to fetch')) return 'Unable to reach the authentication server. Check your network or Supabase project status.';
  if (m.includes('invalid') && m.includes('email')) return 'Please enter a valid email address.';
  return message;
};

/**
 * Sign in using either Username or Email + Password (2 parameters).
 */
export async function signIn(identifier: string, password: string) {
  ensureConfigured();
  const cleanId = identifier.trim();
  let emailToUse = cleanId;

  // If the user typed a username (no @ symbol), attempt to resolve their email from profiles
  if (!cleanId.includes('@')) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('username', cleanId.toLowerCase())
        .maybeSingle();

      if (profile?.email) {
        emailToUse = profile.email;
      }
    } catch {
      // Fallback to cleanId directly if profiles lookup fails
      emailToUse = cleanId;
    }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailToUse,
    password,
  });

  if (error) throw new Error(friendlyError(error.message));
  return data;
}

/**
 * Register taking name, surname, username, email, workid, and password.
 */
export async function signUp(payload: RegisterPayload) {
  ensureConfigured();
  const username = normalizeUsername(payload.username);
  const email = payload.email.trim().toLowerCase();

  const { data, error } = await supabase.auth.signUp({
    email,
    password: payload.password,
    options: {
      data: {
        name: payload.name.trim(),
        surname: payload.surname.trim(),
        username,
        work_id: payload.workId.trim().toUpperCase(),
      },
    },
  });

  if (error) throw new Error(friendlyError(error));
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new Error('An account with this email is already registered.');
  }

  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(friendlyError(error.message));
}
