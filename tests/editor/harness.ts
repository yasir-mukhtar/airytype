import '@fontsource/inter/400.css';
import { createEditor, type EditorHandle } from '../../src/editor/createEditor';

const prose =
  'A calm writing surface leaves space for thinking. This second sentence stretches across several visible rows, keeping its exact Markdown source, emoji 🌱, and punctuation intact. ';
const fixture =
  '# A place for your thoughts\n\n' +
  Array.from({ length: 80 }, (_, i) => `${i + 1}. ${prose.repeat(3)}`).join(
    '\n\n',
  );
const status = document.querySelector('#status')!;
const editor = createEditor({
  parent: document.querySelector('#editor')!,
  noteId: 'fixture',
  doc: fixture,
  onChange(change) {
    status.textContent = `${change.bytes} bytes${change.overLimit ? ' (oversized, preserved)' : ''}`;
  },
  onLimit(message) {
    status.textContent = message;
  },
});

declare global {
  interface Window {
    editorHarness: EditorHandle;
  }
}
window.editorHarness = editor;
