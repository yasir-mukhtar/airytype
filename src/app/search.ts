import type { NoteRecord } from '../storage/types';

export function searchTokens(query: string): string[] {
  return query
    .slice(0, 200)
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 5);
}

export function searchNotes(notes: NoteRecord[], query: string): NoteRecord[] {
  const tokens = searchTokens(query);
  const rank = (note: NoteRecord) => {
    const title = note.title.toLocaleLowerCase();
    return tokens.every((token) => title.includes(token))
      ? 0
      : tokens.some((token) => title.includes(token))
        ? 1
        : 2;
  };
  return notes
    .filter((note) => {
      const haystack = `${note.title}\n${note.body}`.toLocaleLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.updatedAt - a.updatedAt ||
        a.id.localeCompare(b.id),
    );
}

export function snippet(body: string, query = ''): string {
  const token = searchTokens(query)[0];
  const position = token ? body.toLocaleLowerCase().indexOf(token) : 0;
  const start = Math.max(0, position - 36);
  return `${start ? '…' : ''}${body
    .slice(start, start + 150)
    .replace(/\s+/gu, ' ')
    .trim()}`;
}
