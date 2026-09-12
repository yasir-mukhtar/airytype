import type { EditorPreferences } from '../editor/createEditor';

const preferenceKey = 'airytype:appearance:v1';
export function readPreferences(): EditorPreferences {
  const defaults: EditorPreferences = {
    focus: 'off',
    scroll: 'off',
    language: navigator.language.startsWith('id') ? 'id' : 'en',
  };
  try {
    const stored = JSON.parse(localStorage.getItem(preferenceKey) || '{}');
    return {
      focus: ['off', 'line', 'sentence'].includes(stored.focus)
        ? stored.focus
        : defaults.focus,
      scroll: ['off', 'top', 'middle'].includes(stored.scroll)
        ? stored.scroll
        : defaults.scroll,
      language: ['en', 'id'].includes(stored.language)
        ? stored.language
        : defaults.language,
    };
  } catch {
    return defaults;
  }
}
export function writePreferences(preferences: EditorPreferences) {
  try {
    localStorage.setItem(preferenceKey, JSON.stringify(preferences));
  } catch {
    /* Optional preference persistence. */
  }
}
