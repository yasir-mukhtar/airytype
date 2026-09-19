import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CloudOff,
  Feather,
  FileText,
  Folder,
  FolderPlus,
  Focus,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { createEditor } from '../editor/createEditor';
import type { EditorPreferences } from '../editor/createEditor';
import { initializeNotebook, notebookSession } from './notebook';
import type { LocalRepository } from '../storage/repository';
import type { NotebookSessionSnapshot } from '../auth/notebook-session';
import { AccountPanel } from './AccountPanel';
import {
  signUp,
  requestPasswordReset,
  updatePassword,
  getSession,
} from '../auth/session';
import type { FolderRecord, NoteRecord } from '../storage/types';
import { downloadMarkdown, downloadLibrary, importMarkdown } from '../export';
import { readPreferences, writePreferences } from './preferences';
import { searchNotes, snippet } from './search';

type View = 'all' | 'trash' | 'recovered' | `folder:${string}`;
type Dialog = 'help' | 'export' | 'folder' | 'rename-folder' | 'move' | null;
const dateLabel = (date: number) =>
  new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(
    date,
  );
function lastNoteId(accountId: string) {
  try {
    return localStorage.getItem(
      accountId === 'local-preview'
        ? 'airytype:last-note'
        : `airytype:last-note:${accountId}`,
    );
  } catch {
    return null;
  }
}
function saveLastNote(id: string, accountId: string) {
  try {
    localStorage.setItem(
      accountId === 'local-preview'
        ? 'airytype:last-note'
        : `airytype:last-note:${accountId}`,
      id,
    );
  } catch {
    /* Optional preference. */
  }
}

function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? 'is-active' : ''}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={title}
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}

export function App() {
  const session = useSyncExternalStore(
    notebookSession.subscribe,
    notebookSession.getSnapshot,
  );
  const [accountOpen, setAccountOpen] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(() =>
    new URLSearchParams(window.location.search).has('reset-password'),
  );
  useEffect(() => {
    void initializeNotebook(isMobileDevice()).catch(() => {});
  }, []);
  useEffect(() => {
    const persist = () => {
      void notebookSession
        .getSnapshot()
        .repository.flush()
        .catch(() => {
          setStorageNotice(
            'Couldn’t save on this device. Keep this tab open and export your notebook.',
          );
        });
    };
    const warn = (event: BeforeUnloadEvent) => {
      const current = notebookSession.getSnapshot().repository.getSnapshot();
      if (
        Object.values(current.statuses).some((value) => value !== 'saved-local')
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', persist);
    window.addEventListener('pagehide', persist);
    window.addEventListener('beforeunload', warn);
    return () => {
      document.removeEventListener('visibilitychange', persist);
      window.removeEventListener('pagehide', persist);
      window.removeEventListener('beforeunload', warn);
    };
  }, []);
  const accountContent = (
    <>
      <AccountPanel
        configured={session.configured}
        phase={session.phase}
        email={session.email}
        message={session.message}
        pendingCount={session.pendingCount}
        writer={
          session.repository.getSnapshot().mode === 'writer' &&
          !isMobileDevice()
        }
        onSignIn={(email, password) => notebookSession.signIn(email, password)}
        onOpenAccount={() => notebookSession.openAccountNotebook()}
        onUseLocal={() => notebookSession.useLocalNotebook()}
        onRequestLogout={() => notebookSession.requestLogout()}
        onCancelLogout={() => notebookSession.cancelLogout()}
        onFinishLogout={() => notebookSession.finishLogout()}
        onExport={async () => {
          const captured = session.repository.getSnapshot();
          downloadLibrary(captured.notes, captured.folders, {
            includeTrash: true,
          });
        }}
        onSignUp={signUp}
        onRequestPasswordReset={requestPasswordReset}
        passwordRecovery={recovery}
        onUpdatePassword={async (password) => {
          const current = await getSession();
          if (
            !current ||
            (session.accountId && current.user.id !== session.accountId)
          )
            throw new Error(
              'This recovery link belongs to a different or expired account session. Request a fresh link for the same account.',
            );
          await updatePassword(password);
          setRecovery(false);
          const url = new URL(window.location.href);
          url.searchParams.delete('reset-password');
          window.history.replaceState(null, '', url);
        }}
      />
      <button
        className="text-button full-width"
        onClick={() => {
          void (async () => {
            try {
              const granted = await navigator.storage?.persist?.();
              setStorageNotice(
                granted
                  ? 'Persistent browser storage granted. Keep exports as a separate backup.'
                  : 'Persistent storage was not granted. Keep downloading important writing.',
              );
            } catch {
              setStorageNotice(
                'Persistent storage could not be requested. Your existing drafts are unchanged.',
              );
            }
          })();
        }}
      >
        Request persistent browser storage
      </button>
      {storageNotice && (
        <p role="status" className="fine-print">
          {storageNotice}
        </p>
      )}
    </>
  );
  if (
    session.phase === 'session-lost' ||
    session.phase === 'signing-out' ||
    (session.phase === 'opening' &&
      session.repository.accountId !== 'local-preview')
  )
    return (
      <main className="session-screen">
        <section className="session-card">
          <h1>
            {session.phase === 'opening'
              ? 'Opening your account notebook'
              : 'Your account notebook is paused'}
          </h1>
          {accountContent}
        </section>
      </main>
    );
  return (
    <>
      <Notebook
        key={session.repository.accountId}
        repository={session.repository}
        session={session}
        onAccount={() => setAccountOpen(true)}
      />
      {(accountOpen || recovery || session.phase === 'logout-pending') && (
        <Modal
          title="Your writing space"
          onClose={() => {
            if (session.phase === 'logout-pending')
              notebookSession.cancelLogout();
            setAccountOpen(false);
            setRecovery(false);
          }}
        >
          {accountContent}
        </Modal>
      )}
    </>
  );
}

function isMobileDevice(): boolean {
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function Notebook({
  repository,
  session,
  onAccount,
}: {
  repository: LocalRepository;
  session: NotebookSessionSnapshot;
  onAccount: () => void;
}) {
  const snapshot = useSyncExternalStore(
    repository.subscribe,
    repository.getSnapshot,
  );
  const [activeId, setActiveId] = useState<string | null>(() =>
    lastNoteId(repository.accountId),
  );
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [preferences, setPreferences] = useState(readPreferences);
  const [distractionFree, setDistractionFree] = useState(false);
  const [railHidden, setRailHidden] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [compactLayout, setCompactLayout] = useState(
    () => window.matchMedia('(max-width: 900px)').matches,
  );
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openingNote, setOpeningNote] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderParent, setFolderParent] = useState('');
  const [includeTrash, setIncludeTrash] = useState(false);
  const [booted, setBooted] = useState(false);
  const [mobile] = useState(
    () =>
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  );
  const editorMount = useRef<HTMLDivElement>(null);
  const editor = useRef<ReturnType<typeof createEditor> | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const notify = useCallback((message: string) => setToast(message), []);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : 'Something went wrong. Your writing is still available here.',
        );
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    let mounted = true;
    void initializeNotebook(mobile)
      .then(() => {
        if (mounted) {
          const notes = repository.listNotes();
          const stored = lastNoteId(repository.accountId);
          setActiveId(
            notes.some((note) => note.id === stored)
              ? stored
              : (notes[0]?.id ?? null),
          );
          setBooted(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setActiveId(repository.listNotes()[0]?.id ?? null);
          setBooted(true);
          notify(
            'Couldn’t finish opening the notebook. Any available drafts remain here for export.',
          );
        }
      });
    return () => {
      mounted = false;
    };
  }, [mobile]);

  const active = snapshot.notes.find((note) => note.id === activeId);
  const sourceTitle = active?.body
    .match(
      /^(?:[ \t]*\n)* {0,3}#[ \t]+([^\n]+?)(?:[ \t]+#+[ \t]*)?(?:\n|$)/,
    )?.[1]
    .trim();
  const titleInDocument = Boolean(sourceTitle && sourceTitle === active?.title);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => {
      setCompactLayout(query.matches);
      setLibraryOpen(false);
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;
    let disposed = false;
    const resize = () => {
      if (disposed) return;
      // Measure without a temporary scrollbar narrowing the wrapping width.
      title.style.overflowY = 'hidden';
      title.style.height = '0px';
      title.style.height = `${title.scrollHeight}px`;
      title.style.overflowY = 'auto';
    };
    resize();
    const geometry = () =>
      `${title.clientWidth}:${getComputedStyle(title).lineHeight}`;
    let measured = geometry();
    const observer = new ResizeObserver(() => {
      if (geometry() === measured) return;
      measured = geometry();
      resize();
    });
    observer.observe(title);
    void document.fonts.ready.then(resize);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [active?.title, titleInDocument, editingTitle]);
  const connected = repository.accountId !== 'local-preview';
  const cloudState = active
    ? notebookSession.getCloudState(active.id)
    : undefined;
  const blocked =
    cloudState?.type === 'paused' &&
    ['conflict', 'epoch', 'session', 'protocol'].includes(cloudState.reason);
  const writable =
    snapshot.mode === 'writer' &&
    !mobile &&
    !openingNote &&
    !blocked &&
    (session.phase === 'local' || session.phase === 'account');
  const canOrganize = writable && !connected;
  const currentFolderId = view.startsWith('folder:') ? view.slice(7) : null;
  const currentFolder = snapshot.folders.find(
    (folder) => folder.id === currentFolderId,
  );
  const viewTitle =
    view === 'trash'
      ? 'Trash'
      : view === 'recovered'
        ? 'Recovered'
        : (currentFolder?.name ?? 'All notes');
  const visibleNotes = useMemo(
    () =>
      searchNotes(
        snapshot.notes.filter((note) => {
          if (view === 'trash') return Boolean(note.deletedAt);
          if (note.deletedAt) return false;
          if (view === 'recovered') return note.kind === 'recovery';
          return !currentFolderId || note.folderId === currentFolderId;
        }),
        query,
      ),
    [snapshot.notes, view, currentFolderId, query],
  );
  const normalCount = snapshot.notes.filter((note) => !note.deletedAt).length;
  const trashCount = snapshot.notes.filter((note) => note.deletedAt).length;
  const status = active ? snapshot.statuses[active.id] : undefined;
  const words = active?.body.trim()
    ? active.body.trim().split(/\s+/u).length
    : 0;
  const statusText =
    status === 'error'
      ? 'Couldn’t save on this device'
      : status === 'saving'
        ? 'Saving on this device…'
        : !connected
          ? 'Saved on this device'
          : cloudState?.type === 'acknowledged'
            ? 'Saved on this device · Cloud save acknowledged'
            : cloudState?.type === 'paused'
              ? 'Saved on this device · Sync paused'
              : cloudState?.type === 'retry'
                ? 'Saved on this device · Waiting to retry'
                : cloudState
                  ? 'Saved on this device · Syncing…'
                  : 'Saved on this device · Cloud copy checked';

  useEffect(() => {
    if (!booted || !editorMount.current || editor.current) return;
    const note = repository.getNote(activeRef.current ?? '');
    editor.current = createEditor({
      parent: editorMount.current,
      noteId: note?.id ?? 'empty',
      doc: note?.body ?? '',
      preferences,
      readOnly: !writable || !note || Boolean(note.deletedAt),
      onChange: (change) => {
        try {
          repository.updateNote(change.noteId, { body: change.body });
        } catch (error) {
          notify(
            error instanceof Error
              ? error.message
              : 'Couldn’t save on this device. Download your writing.',
          );
        }
      },
      onLimit: notify,
    });
    return () => {
      editor.current?.destroy();
      editor.current = null;
    };
    // The EditorView lives for the surface lifetime; compartments handle preferences.
  }, [booted]);

  useLayoutEffect(() => {
    if (!editor.current || !active) return;
    editor.current.openNote({
      noteId: active.id,
      doc: active.body,
      readOnly: !writable || Boolean(active.deletedAt),
    });
    saveLastNote(active.id, repository.accountId);
  }, [activeId, booted]);

  useLayoutEffect(() => {
    editor.current?.setReadOnly(
      !writable || !active || Boolean(active.deletedAt),
    );
  }, [writable, active?.deletedAt, activeId]);
  useEffect(() => {
    if (
      snapshot.mode !== 'writer' &&
      active &&
      editor.current?.getText() !== active.body
    )
      editor.current?.replaceExternal(active.body);
  }, [snapshot.mode, active]);
  useEffect(() => {
    editor.current?.setPreferences(preferences);
    writePreferences(preferences);
  }, [preferences]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLibraryOpen(false);
        setDistractionFree(false);
        setAppearanceOpen(false);
        setMoreOpen(false);
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        setDistractionFree(false);
        setRailHidden(false);
        setLibraryOpen(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void repository
          .flush()
          .catch(() =>
            notify('Couldn’t save on this device. Download your writing.'),
          );
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [notify]);

  function selectNote(note: NoteRecord) {
    if (note.id === activeId) return;
    setOpeningNote(true);
    void run(async () => {
      await repository.flush();
      setActiveId(note.id);
      setMoreOpen(false);
    }).finally(() => setOpeningNote(false));
  }
  function newNote() {
    setOpeningNote(true);
    void run(async () => {
      await repository.flush();
      const note = await repository.createNote({ folderId: currentFolderId });
      if (view === 'trash' || view === 'recovered') setView('all');
      setQuery('');
      setActiveId(note.id);
      requestAnimationFrame(() => titleRef.current?.focus());
    }).finally(() => setOpeningNote(false));
  }
  function chooseView(next: View) {
    setView(next);
    setQuery('');
    setLibraryOpen(false);
  }
  function exportCurrent() {
    if (!active) return;
    downloadMarkdown({
      ...active,
      body: editor.current?.getText() ?? active.body,
    });
    notify('Markdown downloaded. Your words, exactly as written.');
  }
  async function handleImports(files: FileList | null) {
    if (!files?.length) return;
    const selectedAtStart = activeRef.current;
    await run(async () => {
      let succeeded = 0;
      let lastImportedId: string | null = null;
      const failed: string[] = [];
      for (const file of Array.from(files)) {
        try {
          const imported = await importMarkdown(file);
          const note = await repository.createNote({
            ...imported,
            folderId: currentFolderId,
          });
          succeeded += 1;
          lastImportedId = note.id;
        } catch (error) {
          failed.push(
            `${file.name}: ${error instanceof Error ? error.message : 'Import failed'}`,
          );
        }
      }
      if (lastImportedId && activeRef.current === selectedAtStart) {
        await repository.flush();
        setActiveId(lastImportedId);
        setView(currentFolderId ? `folder:${currentFolderId}` : 'all');
        setQuery('');
      }
      notify(
        `${succeeded} ${succeeded === 1 ? 'file' : 'files'} imported.${failed.length ? ` ${failed.length} failed. ${failed.join(' ')}` : ' Your original files are unchanged.'}`,
      );
    });
    if (importRef.current) importRef.current.value = '';
  }
  const updatePreference = <K extends keyof EditorPreferences>(
    key: K,
    value: EditorPreferences[K],
  ) => setPreferences((current) => ({ ...current, [key]: value }));

  function renderFolders(parentId: string | null = null, depth = 0): ReactNode {
    return snapshot.folders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => (
        <div key={folder.id}>
          <button
            className={`nav-item folder-item ${currentFolderId === folder.id ? 'selected' : ''}`}
            style={{ paddingLeft: 12 + depth * 15 }}
            onClick={() => chooseView(`folder:${folder.id}`)}
          >
            <Folder size={16} />
            <span>{folder.name}</span>
            <span className="nav-count">
              {snapshot.notes.filter(
                (note) => !note.deletedAt && note.folderId === folder.id,
              ).length || ''}
            </span>
          </button>
          {renderFolders(folder.id, depth + 1)}
        </div>
      ));
  }

  return (
    <div
      className={`workspace ${distractionFree ? 'distraction-free' : ''} ${railHidden ? 'rail-hidden' : ''} ${libraryOpen ? 'library-open' : ''}`}
    >
      <a
        className="skip-link"
        href="#writing-title"
        onClick={(event) => {
          if (titleInDocument && !editingTitle) {
            event.preventDefault();
            editor.current?.focus();
          }
        }}
      >
        Skip to writing
      </a>
      <aside className="library-rail" aria-label="Library navigation">
        {compactLayout && (
          <div className="library-close">
            <IconButton
              label="Close library"
              onClick={() => setLibraryOpen(false)}
            >
              <X size={18} />
            </IconButton>
          </div>
        )}
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            chooseView('all');
          }}
        >
          <span className="brand-symbol">
            <Feather size={22} strokeWidth={1.55} />
          </span>
          <span>
            airytype<span className="brand-dot">.</span>
          </span>
        </a>
        <button
          className="search-trigger"
          onClick={() => {
            setLibraryOpen(false);
            searchRef.current?.focus();
          }}
        >
          <Search size={16} />
          <span>Find a thought</span>
          <kbd>⇧⌘F</kbd>
        </button>
        <div className="rail-section-label">YOUR SPACE</div>
        <nav>
          <button
            className={`nav-item ${view === 'all' ? 'selected' : ''}`}
            onClick={() => chooseView('all')}
          >
            <BookOpen size={17} />
            <span>All notes</span>
            <span className="nav-count">{normalCount}</span>
          </button>
          <button
            className={`nav-item ${view === 'recovered' ? 'selected' : ''}`}
            onClick={() => chooseView('recovered')}
          >
            <RotateCcw size={16} />
            <span>Recovered</span>
          </button>
        </nav>
        <div className="rail-section-label folders-label">
          <span>FOLDERS</span>
          <IconButton
            label="New folder"
            disabled={!canOrganize || busy}
            onClick={() => {
              setFolderName('');
              setFolderParent('');
              setDialog('folder');
            }}
          >
            <Plus size={15} />
          </IconButton>
        </div>
        <div className="folder-tree">
          {renderFolders()}
          {!snapshot.folders.length && (
            <button
              className="empty-folders"
              disabled={!canOrganize}
              onClick={() => {
                setFolderName('');
                setFolderParent('');
                setDialog('folder');
              }}
            >
              A place for every idea.
              <br />
              <span>
                Create your first folder <Plus size={12} />
              </span>
            </button>
          )}
        </div>
        <div className="rail-bottom">
          <button
            className={`nav-item ${view === 'trash' ? 'selected' : ''}`}
            onClick={() => chooseView('trash')}
          >
            <Trash2 size={16} />
            <span>Trash</span>
            <span className="nav-count">{trashCount || ''}</span>
          </button>
          <button className="nav-item" onClick={() => setDialog('help')}>
            <CircleHelp size={16} />
            <span>A little help</span>
          </button>
          <div className="rail-divider" />
          <button className="profile" onClick={() => onAccount()}>
            <span className="avatar">
              <Feather size={17} />
            </span>
            <span>
              <strong>Your writing space</strong>
              <small>
                {connected
                  ? (session.email ?? 'Account notebook')
                  : 'Local development preview'}
              </small>
            </span>
            <MoreHorizontal size={17} />
          </button>
        </div>
      </aside>

      <section className="note-panel" aria-label="Notes">
        <header className="note-panel-heading">
          <div>
            <span className="eyebrow">THE NOTEBOOK</span>
            <h1>{viewTitle}</h1>
            <select
              className="mobile-library-select"
              aria-label="Library view"
              value={view}
              onChange={(event) => chooseView(event.target.value as View)}
            >
              <option value="all">All notes</option>
              <option value="trash">Trash</option>
              <option value="recovered">Recovered</option>
              {snapshot.folders.map((folder) => (
                <option key={folder.id} value={`folder:${folder.id}`}>
                  {folderPath(folder, snapshot.folders)}
                </option>
              ))}
            </select>
          </div>
          <IconButton
            label="New note"
            disabled={!writable || busy}
            onClick={newNote}
          >
            <Plus size={20} />
          </IconButton>
        </header>
        <div className="note-search">
          <Search size={15} />
          <input
            ref={searchRef}
            aria-label="Search this device"
            placeholder="Search this device…"
            value={query}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query && (
            <IconButton label="Clear search" onClick={() => setQuery('')}>
              <X size={13} />
            </IconButton>
          )}
        </div>
        <div className="note-list-label">
          <span>
            {query
              ? `${visibleNotes.length} ${visibleNotes.length === 1 ? 'match' : 'matches'} on this device`
              : `${visibleNotes.length} ${visibleNotes.length === 1 ? 'note' : 'notes'}`}
          </span>
          {currentFolder ? (
            <button
              disabled={!canOrganize}
              onClick={() => {
                setFolderName(currentFolder.name);
                setFolderParent(currentFolder.parentId ?? '');
                setDialog('rename-folder');
              }}
            >
              Manage folder
            </button>
          ) : (
            <span>
              Last edited <ChevronDown size={11} />
            </span>
          )}
        </div>
        <div className="note-list">
          {!booted ? (
            <div className="empty-list">
              <span className="loading-dot" />
              Opening your notebook…
            </div>
          ) : visibleNotes.length ? (
            visibleNotes.map((note) => (
              <button
                key={note.id}
                className={`note-card ${activeId === note.id ? 'active' : ''}`}
                aria-current={activeId === note.id ? 'true' : undefined}
                onClick={() => selectNote(note)}
              >
                <div className="note-card-title">
                  {note.title || 'Untitled'}
                  {snapshot.statuses[note.id] === 'saving' && (
                    <span
                      className="pending-dot"
                      title="Saving on this device"
                    />
                  )}
                </div>
                <p>
                  {snippet(note.body, query) ||
                    'A fresh page. See where it takes you.'}
                </p>
                <div className="note-card-meta">
                  <span>{dateLabel(note.updatedAt)}</span>
                  <span>
                    {note.folderId ? (
                      <>
                        <Folder size={11} />
                        {snapshot.folders.find(
                          (folder) => folder.id === note.folderId,
                        )?.name ?? 'Unfiled'}
                      </>
                    ) : (
                      <>
                        <FileText size={11} />
                        Markdown
                      </>
                    )}
                  </span>
                </div>
              </button>
            ))
          ) : (
            <div className="empty-list">
              <FileText size={26} strokeWidth={1.3} />
              <h3>
                {query
                  ? 'No matching notes here'
                  : view === 'trash'
                    ? 'Nothing in Trash'
                    : view === 'recovered'
                      ? 'No recovered copies'
                      : 'Room for something new'}
              </h3>
              <p>
                {query
                  ? 'Try another word. This search covers notes saved in this browser.'
                  : view === 'trash'
                    ? 'Notes you move to Trash will stay here until you restore them.'
                    : view === 'recovered'
                      ? 'Conflict recovery will appear here when cloud sync is enabled.'
                      : 'Start a note and follow your curiosity.'}
              </p>
              {!query && !['trash', 'recovered'].includes(view) && (
                <button
                  className="text-button"
                  disabled={!writable}
                  onClick={newNote}
                >
                  Create a note <Plus size={14} />
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="note-panel-footer">
          <button
            aria-label="Import Markdown"
            onClick={() => importRef.current?.click()}
            disabled={!canOrganize || busy}
          >
            <ArrowUpFromLine size={14} />
            Import Markdown
          </button>
          <IconButton
            label="Export library"
            onClick={() => setDialog('export')}
          >
            <ArrowDownToLine size={16} />
          </IconButton>
        </footer>
      </section>

      <main className="writing-panel">
        <header className="writing-toolbar">
          <div className="toolbar-left">
            <IconButton
              label={
                distractionFree
                  ? 'Show library'
                  : compactLayout
                    ? !libraryOpen
                      ? 'Show folders'
                      : 'Hide folders'
                    : railHidden
                      ? 'Show folders'
                      : 'Hide folders'
              }
              onClick={() =>
                distractionFree
                  ? setDistractionFree(false)
                  : compactLayout
                    ? setLibraryOpen(!libraryOpen)
                    : setRailHidden(!railHidden)
              }
            >
              {distractionFree ||
              (compactLayout ? !libraryOpen : railHidden) ? (
                <PanelLeftOpen size={18} />
              ) : (
                <PanelLeftClose size={18} />
              )}
            </IconButton>
            <span className="toolbar-divider" />
            <div className="breadcrumb">
              <span>
                {active?.folderId
                  ? (snapshot.folders.find(
                      (folder) => folder.id === active.folderId,
                    )?.name ?? 'Notes')
                  : 'Your space'}
              </span>
              <ChevronRight size={12} />
              <span>{active?.title || 'Untitled'}</span>
            </div>
          </div>
          <div className="toolbar-right">
            <div className="popover-anchor">
              <button
                className={`writing-settings ${appearanceOpen ? 'is-active' : ''}`}
                aria-label="Writing controls"
                onClick={() => {
                  setAppearanceOpen(!appearanceOpen);
                  setMoreOpen(false);
                }}
                aria-expanded={appearanceOpen}
              >
                <Settings2 size={16} />
                <span>Writing controls</span>
                <ChevronDown size={12} />
              </button>
              {appearanceOpen && (
                <div className="appearance-popover popover">
                  <div className="popover-title">
                    <Focus size={16} />
                    <strong>Find your flow</strong>
                    <IconButton
                      label="Close writing controls"
                      onClick={() => setAppearanceOpen(false)}
                    >
                      <X size={14} />
                    </IconButton>
                  </div>
                  <label>Focus highlight</label>
                  <div
                    className="segmented"
                    role="group"
                    aria-label="Focus highlight"
                  >
                    {(['off', 'line', 'sentence'] as const).map((mode) => (
                      <button
                        key={mode}
                        className={preferences.focus === mode ? 'selected' : ''}
                        aria-pressed={preferences.focus === mode}
                        onClick={() => updatePreference('focus', mode)}
                      >
                        {mode === 'off'
                          ? 'Off'
                          : mode === 'line'
                            ? 'Line'
                            : 'Sentence'}
                      </button>
                    ))}
                  </div>
                  <p>
                    Keep your attention on a single wrapped line or sentence.
                  </p>
                  <label>Typewriter scrolling</label>
                  <div
                    className="segmented"
                    role="group"
                    aria-label="Typewriter scrolling"
                  >
                    {(['off', 'top', 'middle'] as const).map((mode) => (
                      <button
                        key={mode}
                        className={
                          preferences.scroll === mode ? 'selected' : ''
                        }
                        aria-pressed={preferences.scroll === mode}
                        onClick={() => updatePreference('scroll', mode)}
                      >
                        {mode === 'off'
                          ? 'Off'
                          : mode === 'top'
                            ? 'Top'
                            : 'Middle'}
                      </button>
                    ))}
                  </div>
                  <p>
                    Your writing stays in place. Scroll freely to look around.
                  </p>
                  <label htmlFor="sentence-language">Sentence language</label>
                  <select
                    id="sentence-language"
                    value={preferences.language}
                    onChange={(event) =>
                      updatePreference(
                        'language',
                        event.target.value as 'en' | 'id',
                      )
                    }
                  >
                    <option value="en">English</option>
                    <option value="id">Bahasa Indonesia</option>
                  </select>
                  <p className="small-help">
                    Code, links, and prose blocks over 16,000 characters use
                    line focus.
                  </p>
                </div>
              )}
            </div>
            <IconButton
              label={
                distractionFree
                  ? 'Exit distraction-free mode'
                  : 'Enter distraction-free mode'
              }
              active={distractionFree}
              onClick={() => setDistractionFree(!distractionFree)}
            >
              {distractionFree ? (
                <Minimize2 size={17} />
              ) : (
                <Maximize2 size={17} />
              )}
            </IconButton>
            <span className="toolbar-divider" />
            <IconButton
              label="Download current note"
              disabled={!active}
              onClick={exportCurrent}
            >
              <ArrowDownToLine size={17} />
            </IconButton>
            <div className="popover-anchor">
              <IconButton
                label="Note actions"
                disabled={!active}
                onClick={() => {
                  setMoreOpen(!moreOpen);
                  setAppearanceOpen(false);
                }}
              >
                <MoreHorizontal size={20} />
              </IconButton>
              {moreOpen && (
                <div className="actions-popover popover">
                  <button
                    disabled={!writable || Boolean(active?.deletedAt)}
                    onClick={() => {
                      setEditingTitle(true);
                      setMoreOpen(false);
                      requestAnimationFrame(() => {
                        titleRef.current?.focus();
                        titleRef.current?.select();
                      });
                    }}
                  >
                    <FileText size={15} />
                    Rename note
                  </button>
                  <button
                    onClick={() => {
                      editor.current?.find();
                      setMoreOpen(false);
                    }}
                  >
                    <Search size={15} />
                    Find in this note
                  </button>
                  <button
                    disabled={!canOrganize || Boolean(active?.deletedAt)}
                    onClick={() => {
                      setFolderParent(active?.folderId ?? '');
                      setDialog('move');
                      setMoreOpen(false);
                    }}
                  >
                    <Folder size={15} />
                    Move to folder
                  </button>
                  <button
                    onClick={() => {
                      exportCurrent();
                      setMoreOpen(false);
                    }}
                  >
                    <ArrowDownToLine size={15} />
                    Download Markdown
                  </button>
                  <div className="menu-divider" />
                  <button
                    className="danger-text"
                    disabled={!canOrganize || busy}
                    onClick={() => {
                      if (!active) return;
                      void run(async () => {
                        if (active.deletedAt) {
                          await repository.restoreNote(active.id);
                          setView('all');
                        } else {
                          await repository.trashNote(active.id);
                          setView('trash');
                        }
                        setMoreOpen(false);
                      });
                    }}
                  >
                    {active?.deletedAt ? (
                      <>
                        <RotateCcw size={15} />
                        Restore note
                      </>
                    ) : (
                      <>
                        <Trash2 size={15} />
                        Move to Trash
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {connected && (
          <div className="notice" role="status">
            Account notebook preview. Folder changes, Trash and imports are not
            available yet.
            {cloudState?.type === 'paused' && (
              <span> {cloudState.message}</span>
            )}
          </div>
        )}
        {snapshot.mode !== 'writer' && booted && (
          <div className="notice" role="status">
            {snapshot.mode === 'readonly'
              ? 'This tab is read-only. Return to your writing tab, or wait for it to save, close it, and reload this tab.'
              : 'This browser cannot safely save drafts. Use a browser with IndexedDB and Web Locks.'}
          </div>
        )}
        {mobile && (
          <div className="notice">
            The mobile companion is read-only. Open AiryType on a desktop to
            write.
          </div>
        )}
        {snapshot.error && (
          <div className="notice error" role="alert">
            {snapshot.error}
            <button onClick={exportCurrent}>Download current note</button>
          </div>
        )}
        {active?.deletedAt && (
          <div className="notice">
            This note is in Trash. Its text is preserved.
            <button
              disabled={!canOrganize || busy}
              onClick={() =>
                void run(async () => {
                  await repository.restoreNote(active.id);
                  setView('all');
                })
              }
            >
              Restore note
            </button>
          </div>
        )}

        <div className={`document-surface ${!active ? 'no-active-note' : ''}`}>
          <div
            className="document-heading"
            hidden={titleInDocument && !editingTitle}
          >
            <textarea
              id="writing-title"
              ref={titleRef}
              className="document-title"
              aria-label="Note title"
              placeholder="Untitled"
              rows={1}
              value={active?.title ?? ''}
              disabled={!active || !writable || Boolean(active.deletedAt)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  editor.current?.focus();
                }
              }}
              onChange={(event) => {
                if (!active) return;
                try {
                  repository.updateNote(active.id, {
                    title: event.target.value.replace(/[\r\n]+/g, ' '),
                  });
                } catch (error) {
                  notify(
                    error instanceof Error
                      ? error.message
                      : 'Couldn’t update the title.',
                  );
                }
              }}
            />
            <div className="document-byline">
              {active ? (
                <>
                  A thought in progress<span>·</span>
                  {dateLabel(active.createdAt)}
                </>
              ) : (
                'A fresh page is a good place to start.'
              )}
            </div>
          </div>
          <div
            ref={editorMount}
            className="editor-mount"
            aria-label="Markdown writing surface"
          />
          {!active && booted && (
            <div className="empty-editor">
              <Feather size={38} strokeWidth={1.1} />
              <h2>A little space to begin.</h2>
              <p>Choose a note, or make room for a new thought.</p>
              <button
                className="primary-button"
                disabled={!writable || busy}
                onClick={newNote}
              >
                <Plus size={16} />
                New note
              </button>
            </div>
          )}
        </div>
        <footer className="writing-footer">
          <button
            className={`save-status ${status === 'error' ? 'status-error' : ''}`}
            onClick={() => onAccount()}
          >
            <span
              className={`status-dot ${status === 'saving' ? 'saving' : ''}`}
            />
            {active ? statusText : 'Local development preview'}
          </button>
          <div>
            <span>
              {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
            </span>
            <span className="footer-dot">·</span>
            <span>Markdown</span>
            <span className="footer-dot">·</span>
            <span className="quiet-tag">Breathe. Write.</span>
          </div>
        </footer>
      </main>

      <input
        ref={importRef}
        type="file"
        accept=".md,.txt,text/markdown,text/plain"
        multiple
        hidden
        onChange={(event) => void handleImports(event.target.files)}
      />
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <IconButton
            label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={15} />
          </IconButton>
        </div>
      )}
      {dialog && (
        <Modal
          title={
            dialog === 'help'
              ? 'A little help'
              : dialog === 'export'
                ? 'Take your words with you'
                : dialog === 'folder'
                  ? 'A home for your ideas'
                  : dialog === 'rename-folder'
                    ? 'Rename folder'
                    : dialog === 'move'
                      ? 'Move this note'
                      : 'About your writing space'
          }
          onClose={() => setDialog(null)}
        >
          {dialog === 'help' && (
            <div className="help-content">
              <p>
                AiryType is a quiet place to write in plain Markdown. Your note
                title is separate from the text you write.
              </p>
              <div className="help-row">
                <Focus size={20} />
                <div>
                  <h3>One thought at a time</h3>
                  <p>
                    Writing controls let you highlight a line or sentence and
                    choose where typing stays on the page. Both start off.
                  </p>
                </div>
              </div>
              <div className="help-row">
                <FileText size={20} />
                <div>
                  <h3>Your writing stays yours</h3>
                  <p>
                    Download the current note at any time. Library export
                    includes a manifest and folder paths. Imports accept UTF-8
                    .md and .txt, normalizing CRLF line endings to LF.
                  </p>
                </div>
              </div>
              <div className="help-row">
                <CloudOff size={20} />
                <div>
                  <h3>
                    {connected
                      ? 'Account notebook preview'
                      : 'This is a local development preview'}
                  </h3>
                  <p>
                    {connected
                      ? 'Cloud writes show their acknowledgement separately from device saves. Conflict recovery, complete cloud export, and public sharing are still under development.'
                      : 'Drafts stay in this browser. Open a separate account notebook to use configured cloud storage.'}{' '}
                    Browser data can be cleared or evicted, so export important
                    writing.
                  </p>
                </div>
              </div>
              <div className="shortcut-list">
                <span>Search this device</span>
                <kbd>Shift + ⌘ / Ctrl + F</kbd>
                <span>Save on this device</span>
                <kbd>⌘ / Ctrl + S</kbd>
                <span>Leave distraction-free mode</span>
                <kbd>Esc</kbd>
              </div>
              <p className="fine-print">
                Desktop editing is under verification. Native Safari, IME, and
                assistive-technology checks are still required before beta.
              </p>
            </div>
          )}
          {dialog === 'export' && (
            <div className="help-content">
              <p>
                Download a ZIP with your Markdown files, folders, and an export
                manifest. This export covers this browser’s notebook.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={includeTrash}
                  onChange={(event) => setIncludeTrash(event.target.checked)}
                />
                Include notes in Trash
              </label>
              <div className="export-summary">
                <FileText size={18} />
                <span>
                  {
                    snapshot.notes.filter(
                      (note) => includeTrash || !note.deletedAt,
                    ).length
                  }{' '}
                  notes<span className="muted"> · Exact Markdown text</span>
                </span>
              </div>
              <p className="fine-print">
                The export captures the current local drafts when you press
                Download. Later edits are not added to this bundle.
              </p>
              <button
                className="primary-button full-width"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await downloadLibrary(snapshot.notes, snapshot.folders, {
                      includeTrash,
                    });
                    setDialog(null);
                    notify('Your notebook has been downloaded.');
                  })
                }
              >
                <ArrowDownToLine size={16} />
                Download notebook
              </button>
            </div>
          )}
          {(dialog === 'folder' || dialog === 'rename-folder') && (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                void run(async () => {
                  if (dialog === 'rename-folder' && currentFolder)
                    await repository.renameFolder(currentFolder.id, folderName);
                  else {
                    const folder = await repository.createFolder(
                      folderName,
                      folderParent || null,
                    );
                    setView(`folder:${folder.id}`);
                  }
                  setDialog(null);
                });
              }}
            >
              <label className="field-label" htmlFor="folder-name">
                Folder name
              </label>
              <input
                id="folder-name"
                className="text-input"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="e.g. Morning pages"
                autoFocus
                required
              />
              {dialog === 'folder' && (
                <>
                  <label className="field-label" htmlFor="parent-folder">
                    Inside
                  </label>
                  <select
                    id="parent-folder"
                    value={folderParent}
                    onChange={(event) => setFolderParent(event.target.value)}
                  >
                    <option value="">Your space</option>
                    {snapshot.folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folderPath(folder, snapshot.folders)}
                      </option>
                    ))}
                  </select>
                  <p className="fine-print">
                    Keep things simple with up to three folder levels.
                  </p>
                </>
              )}
              <button
                type="submit"
                className="primary-button full-width"
                disabled={busy || !folderName.trim()}
              >
                {dialog === 'folder' ? (
                  <FolderPlus size={16} />
                ) : (
                  <Check size={16} />
                )}
                {dialog === 'folder' ? 'Create folder' : 'Save name'}
              </button>
            </form>
          )}
          {dialog === 'move' && (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                if (!active) return;
                void run(async () => {
                  await repository.flush();
                  repository.updateNote(active.id, {
                    folderId: folderParent || null,
                  });
                  await repository.flush();
                  setDialog(null);
                  notify('Note moved.');
                });
              }}
            >
              <p>Choose a folder for “{active?.title || 'Untitled'}”.</p>
              <label className="field-label" htmlFor="destination-folder">
                Destination
              </label>
              <select
                id="destination-folder"
                value={folderParent}
                onChange={(event) => setFolderParent(event.target.value)}
              >
                <option value="">Your space · Unfiled</option>
                {snapshot.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folderPath(folder, snapshot.folders)}
                  </option>
                ))}
              </select>
              <button
                className="primary-button full-width"
                type="submit"
                disabled={busy}
              >
                <Folder size={16} />
                Move note
              </button>
            </form>
          )}
          {dialog === 'rename-folder' && currentFolder && (
            <div className="folder-management">
              <label className="field-label" htmlFor="move-folder-parent">
                Move folder inside
              </label>
              <select
                id="move-folder-parent"
                value={folderParent}
                onChange={(event) => setFolderParent(event.target.value)}
              >
                <option value="">Your space</option>
                {snapshot.folders
                  .filter((folder) => folder.id !== currentFolder.id)
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folderPath(folder, snapshot.folders)}
                    </option>
                  ))}
              </select>
              <button
                className="text-button full-width"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await repository.moveFolder(
                      currentFolder.id,
                      folderParent || null,
                    );
                    setDialog(null);
                    notify('Folder moved.');
                  })
                }
              >
                <Folder size={14} />
                Move folder
              </button>
              <button
                className="text-button full-width danger-text"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await repository.deleteFolder(currentFolder.id);
                    setView('all');
                    setDialog(null);
                    notify(
                      'Empty folder removed. Notes in Trash are preserved and restore to your space.',
                    );
                  })
                }
              >
                <Trash2 size={14} />
                Delete empty folder
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function folderPath(
  folder: FolderRecord,
  folders: readonly FolderRecord[],
): string {
  const parts = [folder.name];
  let parent = folder.parentId;
  const seen = new Set([folder.id]);
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const ancestor = folders.find((item) => item.id === parent);
    if (!ancestor) break;
    parts.unshift(ancestor.name);
    parent = ancestor.parentId;
  }
  return parts.join(' / ');
}
