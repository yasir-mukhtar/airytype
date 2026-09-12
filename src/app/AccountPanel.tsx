import { useId, useRef, useState, type FormEvent } from 'react';
import { ArrowDownToLine, Cloud, CloudOff, LogOut } from 'lucide-react';
import './account.css';

export type AccountPhase =
  | 'local'
  | 'opening'
  | 'account'
  | 'session-lost'
  | 'logout-pending'
  | 'signing-out';

export interface AccountPanelProps {
  configured: boolean;
  phase: AccountPhase;
  email: string | null;
  message: string | null;
  pendingCount: number;
  writer: boolean;
  onSignIn: (email: string, password: string) => Promise<void>;
  onOpenAccount: () => Promise<void>;
  onUseLocal: () => Promise<void>;
  onRequestLogout: () => Promise<void>;
  onCancelLogout: () => void;
  onFinishLogout: () => Promise<void>;
  onExport: () => Promise<void>;
  onSignUp?: (email: string, password: string) => Promise<void>;
  onRequestPasswordReset?: (email: string) => Promise<void>;
  onUpdatePassword?: (password: string) => Promise<void>;
  passwordRecovery?: boolean;
}

type FormMode = 'sign-in' | 'sign-up' | 'reset';

/** Content for the notebook's existing modal; account transitions belong to its owner. */
export function AccountPanel({
  configured,
  phase,
  email,
  message,
  pendingCount,
  writer,
  onSignIn,
  onOpenAccount,
  onUseLocal,
  onRequestLogout,
  onCancelLogout,
  onFinishLogout,
  onExport,
  onSignUp,
  onRequestPasswordReset,
  onUpdatePassword,
  passwordRecovery = false,
}: AccountPanelProps) {
  const id = useId();
  const [enteredEmail, setEnteredEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formMode, setFormMode] = useState<FormMode>('sign-in');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [information, setInformation] = useState<string | null>(null);
  const action = useRef(0);
  const running = useRef(false);
  const exporting = useRef(false);
  const sessionLost = phase === 'session-lost';
  const pendingLogout = phase === 'logout-pending';
  const transitioning = phase === 'opening' || phase === 'signing-out';
  const disabled = Boolean(busy) || transitioning || !writer;
  const mode = sessionLost ? 'sign-in' : formMode;
  const signInEmail = sessionLost && email ? email : enteredEmail;
  const recovery = configured && passwordRecovery && onUpdatePassword;
  const showCredentials =
    configured && !recovery && (sessionLost || (phase === 'local' && !email));

  async function run(task: () => Promise<void>, label: string) {
    if (running.current) return;
    running.current = true;
    const current = ++action.current;
    setBusy(label);
    setError(null);
    setInformation(null);
    try {
      await task();
    } catch (cause) {
      if (current === action.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'This action could not be completed. Please try again.',
        );
    } finally {
      if (current === action.current) {
        running.current = false;
        setBusy(null);
      }
    }
  }

  async function exportNotebook() {
    if (exporting.current) return;
    exporting.current = true;
    setExportBusy(true);
    setExportError(null);
    try {
      await onExport();
    } catch (cause) {
      setExportError(
        cause instanceof Error
          ? cause.message
          : 'The export could not be completed. Your drafts are preserved.',
      );
    } finally {
      exporting.current = false;
      setExportBusy(false);
    }
  }

  function changeMode(next: FormMode) {
    setFormMode(next);
    setError(null);
    setInformation(null);
    setPassword('');
  }

  function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    void run(
      async () => {
        try {
          if (mode === 'reset' && onRequestPasswordReset) {
            await onRequestPasswordReset(signInEmail.trim());
            setInformation(
              'If an account exists for this email, a password reset link will arrive shortly.',
            );
          } else if (mode === 'sign-up' && onSignUp) {
            await onSignUp(signInEmail.trim(), password);
            setInformation(
              'Check your email to confirm your account, then return here to sign in.',
            );
            setFormMode('sign-in');
          } else {
            await onSignIn(signInEmail.trim(), password);
          }
        } finally {
          setPassword('');
        }
      },
      mode === 'reset'
        ? 'Sending reset link…'
        : mode === 'sign-up'
          ? 'Creating account…'
          : 'Signing in…',
    );
  }

  function cancelLogout() {
    // The owner fences the pending operation; this also ignores its later UI result.
    action.current += 1;
    running.current = false;
    setBusy(null);
    setError(null);
    setInformation(null);
    onCancelLogout();
  }

  const status =
    busy ??
    (phase === 'opening'
      ? 'Opening your account notebook…'
      : phase === 'signing-out'
        ? 'Signing out and closing the account notebook…'
        : (information ?? message));

  return (
    <div className="help-content account-panel">
      <div className="account-illustration" aria-hidden="true">
        {phase === 'local' || sessionLost ? (
          <CloudOff size={30} strokeWidth={1.4} />
        ) : (
          <Cloud size={30} strokeWidth={1.4} />
        )}
      </div>

      {phase === 'local' && (
        <>
          <h3>Your local notebook</h3>
          <p>
            Local drafts stay on this device and never upload automatically.
            Signing in opens a separate account notebook. Your local notebook
            will still be here when you return to it.
          </p>
          {!configured && (
            <p className="account-notice">
              Cloud accounts are unavailable because this preview has no cloud
              settings configured. You can keep writing and exporting your local
              notebook.
            </p>
          )}
          {configured && email && !recovery && (
            <>
              <p>
                Signed in as <strong className="account-email">{email}</strong>.
              </p>
              <button
                type="button"
                className="primary-button full-width"
                disabled={disabled}
                onClick={() =>
                  void run(onOpenAccount, 'Opening account notebook…')
                }
              >
                <Cloud size={16} /> Open account notebook
              </button>
              <button
                type="button"
                className="text-button full-width"
                disabled={Boolean(busy) || transitioning}
                onClick={() =>
                  void run(onRequestLogout, 'Preparing to sign out…')
                }
              >
                {writer ? 'Sign out' : 'Request sign out'}
              </button>
            </>
          )}
        </>
      )}

      {phase === 'account' && (
        <>
          <h3>Your account notebook</h3>
          <p>
            Signed in as <strong className="account-email">{email}</strong>.{' '}
            This notebook belongs to your account. Your local drafts remain
            separate on this device.
          </p>
          <p>
            {pendingCount > 0
              ? `${pendingCount} ${pendingCount === 1 ? 'change is' : 'changes are'} waiting to upload. Keep this writing tab open to let uploads finish.`
              : pendingCount < 0
                ? 'Pending uploads could not be checked. Keep this writing tab open and export your drafts if needed.'
                : 'No changes are waiting to upload from this device.'}
          </p>
          <button
            type="button"
            className="text-button full-width"
            disabled={disabled}
            onClick={() => void run(onUseLocal, 'Opening local notebook…')}
          >
            Open local notebook
          </button>
          <button
            type="button"
            className="text-button full-width"
            disabled={Boolean(busy) || transitioning}
            onClick={() => void run(onRequestLogout, 'Preparing to sign out…')}
          >
            <LogOut size={15} /> {writer ? 'Sign out' : 'Request sign out'}
          </button>
        </>
      )}

      {sessionLost && (
        <>
          <h3>Sign in again to continue</h3>
          <p>
            Your session has ended. Your account drafts are preserved on this
            device, and writing and uploads are paused. Sign in to the same
            account to reopen them.
          </p>
          <button
            type="button"
            className="text-button full-width"
            disabled={disabled}
            onClick={() => void run(onUseLocal, 'Opening local notebook…')}
          >
            Open local notebook
          </button>
        </>
      )}

      {pendingLogout && (
        <>
          <h3>Finish saving before signing out</h3>
          <p>
            {pendingCount > 0
              ? `${pendingCount} ${pendingCount === 1 ? 'change still needs' : 'changes still need'} to upload. Writing is paused while sign-out is pending.`
              : pendingCount < 0
                ? 'Pending uploads could not be checked. Sign-out will wait until saving can be confirmed.'
                : 'Uploads from this device have finished. You can now sign out.'}{' '}
            You can cancel to return to your account notebook or export your
            drafts now.
          </p>
          <button
            type="button"
            className="primary-button full-width"
            disabled={disabled}
            onClick={() => void run(onFinishLogout, 'Waiting for uploads…')}
          >
            {pendingCount !== 0 ? 'Wait for uploads' : 'Sign out'}
          </button>
          <button
            type="button"
            className="text-button full-width"
            disabled={!writer}
            onClick={cancelLogout}
          >
            Cancel sign out
          </button>
        </>
      )}

      {recovery && (
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled) return;
            void run(async () => {
              try {
                await onUpdatePassword(password);
                setInformation('Your password has been updated.');
              } finally {
                setPassword('');
              }
            }, 'Updating password…');
          }}
        >
          <h3>Choose a new password</h3>
          <label className="field-label" htmlFor={`${id}-new-password`}>
            New password
          </label>
          <input
            id={`${id}-new-password`}
            className="text-input"
            name="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={disabled}
            minLength={8}
            required
          />
          <p className="fine-print">Use at least 8 characters.</p>
          <button className="primary-button full-width" disabled={disabled}>
            Save new password
          </button>
        </form>
      )}

      {showCredentials && (
        <form className="account-form" onSubmit={submitCredentials}>
          {!sessionLost && (
            <h3>
              {mode === 'reset'
                ? 'Reset your password'
                : mode === 'sign-up'
                  ? 'Create an account'
                  : 'Sign in to your account'}
            </h3>
          )}
          <label className="field-label" htmlFor={`${id}-email`}>
            Email
          </label>
          <input
            id={`${id}-email`}
            className="text-input"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={signInEmail}
            onChange={(event) => setEnteredEmail(event.target.value)}
            readOnly={sessionLost && Boolean(email)}
            disabled={disabled}
            required
          />
          {mode !== 'reset' && (
            <>
              <label className="field-label" htmlFor={`${id}-password`}>
                Password
              </label>
              <input
                id={`${id}-password`}
                className="text-input"
                name="password"
                type="password"
                autoComplete={
                  mode === 'sign-up' ? 'new-password' : 'current-password'
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={disabled}
                minLength={mode === 'sign-up' ? 8 : undefined}
                required
              />
              {mode === 'sign-up' && (
                <p className="fine-print">
                  Use at least 8 characters. You’ll confirm your email before
                  opening your account notebook.
                </p>
              )}
            </>
          )}
          <button className="primary-button full-width" disabled={disabled}>
            {mode === 'reset'
              ? 'Send password reset link'
              : mode === 'sign-up'
                ? 'Create account'
                : sessionLost
                  ? 'Sign in again'
                  : 'Sign in'}
          </button>
          {sessionLost && email && onRequestPasswordReset && (
            <button
              type="button"
              className="text-button full-width"
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  await onRequestPasswordReset(email);
                  setInformation(
                    'If an account exists for this email, a password reset link will arrive shortly.',
                  );
                }, 'Sending reset link…')
              }
            >
              Send password reset link
            </button>
          )}
          {!sessionLost && (
            <div className="account-form-links">
              {mode !== 'sign-in' && (
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() => changeMode('sign-in')}
                >
                  Back to sign in
                </button>
              )}
              {mode === 'sign-in' && onSignUp && (
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() => changeMode('sign-up')}
                >
                  Create account
                </button>
              )}
              {mode === 'sign-in' && onRequestPasswordReset && (
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() => changeMode('reset')}
                >
                  Forgot password?
                </button>
              )}
            </div>
          )}
        </form>
      )}

      {transitioning && (
        <p>
          Your drafts are preserved while the notebook changes. Please keep this
          tab open until it finishes.
        </p>
      )}
      {!writer && (
        <p className="account-notice">
          Open your account notebook in the writing tab. This tab can request
          sign-out there and export the drafts it has loaded.
        </p>
      )}
      <div
        className="account-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {status && <p>{status}</p>}
      </div>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {exportError && (
        <p className="account-error" role="alert">
          {exportError}
        </p>
      )}
      <button
        type="button"
        className="text-button full-width"
        disabled={exportBusy}
        onClick={() => void exportNotebook()}
      >
        <ArrowDownToLine size={16} /> Export notebook
      </button>
      {exportBusy && <p role="status">Preparing notebook export…</p>}
      <p className="fine-print">
        Browser storage can be cleared. Download important writing to keep a
        copy you control.
      </p>
    </div>
  );
}
