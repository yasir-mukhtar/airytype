import { cloudConfigured } from './client';
import {
  getSession,
  signIn,
  signOutLocal,
  subscribeToSession,
  type Session,
} from './session';
import type { NotebookAuth, NotebookAuthSession } from './notebook-session';

/** UI/session fencing only. Private RPCs independently authorize every request. */
export function notebookIdentity(
  session: Session | null,
): NotebookAuthSession | null {
  if (!session) return null;
  try {
    const payload = session.access_token.split('.')[1];
    const claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { session_id?: unknown };
    if (typeof claims.session_id !== 'string' || !claims.session_id)
      return null;
    return {
      accountId: session.user.id,
      email: session.user.email ?? '',
      verified: Boolean(session.user.email_confirmed_at),
      sessionId: claims.session_id,
    };
  } catch {
    return null;
  }
}

export const notebookAuth: NotebookAuth = {
  configured: cloudConfigured,
  getSession: async () => notebookIdentity(await getSession()),
  subscribe: (listener) =>
    subscribeToSession((session) => listener(notebookIdentity(session))),
  signIn: async (email, password) => {
    const identity = notebookIdentity(await signIn(email, password));
    if (!identity)
      throw new Error(
        'The sign-in session could not be validated. Please sign in again.',
      );
    return identity;
  },
  signOutLocal,
};
