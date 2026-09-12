import type { EditorView } from '@codemirror/view';

export type FocusMode = 'off' | 'line' | 'sentence';
export type ScrollMode = 'off' | 'top' | 'middle';
export type SentenceLanguage = 'en' | 'id';

export interface EditorPreferences {
  focus: FocusMode;
  scroll: ScrollMode;
  language: SentenceLanguage;
}

export interface EditorChange {
  noteId: string;
  body: string;
  bytes: number;
  overLimit: boolean;
}

export interface EditorOptions {
  parent: HTMLElement;
  noteId: string;
  doc: string;
  preferences?: Partial<EditorPreferences>;
  readOnly?: boolean;
  onChange: (change: EditorChange) => void;
  onLimit?: (message: string) => void;
}

export interface EditorController {
  readonly view: EditorView;
  getText(): string;
  focus(): void;
  setPreferences(preferences: Partial<EditorPreferences>): void;
  openNote(note: { noteId: string; doc: string; readOnly?: boolean }): void;
  replaceExternal(doc: string): void;
  setReadOnly(readOnly: boolean): void;
  undo(): boolean;
  redo(): boolean;
  find(): boolean;
  destroy(): void;
}

export const defaultEditorPreferences: EditorPreferences = {
  focus: 'off',
  scroll: 'off',
  language:
    typeof navigator !== 'undefined' && navigator.language.startsWith('id')
      ? 'id'
      : 'en',
};
