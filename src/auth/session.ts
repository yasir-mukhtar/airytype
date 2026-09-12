import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { requireCloud, supabase } from './client';

export type { Session } from '@supabase/supabase-js';

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/** UI identity only. Server RPCs independently verify the authenticated account. */
export function isVerified(session: Session | null): boolean {
  return Boolean(session?.user.email_confirmed_at);
}

/** Callback must stay synchronous; the coordinator owns namespace transitions. */
export function subscribeToSession(
  listener: (session: Session | null, event: AuthChangeEvent) => void,
): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) =>
    listener(session, event),
  );
  return () => data.subscription.unsubscribe();
}

export async function signIn(
  email: string,
  password: string,
): Promise<Session> {
  const { data, error } = await requireCloud().auth.signInWithPassword({
    email,
    password,
  });
  if (error)
    throw new Error(
      'Sign-in failed. Check your email and password, then try again.',
    );
  return data.session;
}

export async function signUp(email: string, password: string): Promise<void> {
  const { error } = await requireCloud().auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin + '/' },
  });
  if (error)
    throw new Error(
      'Account creation could not be completed. Please try again later.',
    );
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await requireCloud().auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/?reset-password=1',
  });
  if (error)
    throw new Error(
      'The reset request could not be completed. Please try again later.',
    );
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await requireCloud().auth.updateUser({ password });
  if (error)
    throw new Error(
      'Your password could not be updated. Request a fresh recovery link and try again.',
    );
}

/** Invoke only after the origin writer has resolved pending drafts and fenced callbacks.
 * This helper deliberately performs no journal deletion or account reassignment.
 */
export async function signOutLocal(): Promise<void> {
  const { error } = await requireCloud().auth.signOut({ scope: 'local' });
  if (error)
    throw new Error(
      'Sign-out failed. Your saved drafts have been retained. Please try again.',
    );
}
