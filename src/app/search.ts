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

export function snippet(body: string, query = '', title = ''): string {
  const token = searchTokens(query)[0];
  let preview = body;
  if (!token) {
    // A list preview should add context to the title. Search still uses the
    // untouched source so literal Markdown queries keep their matching context.
    const heading =
      /^(?:[ \t]*\n)* {0,3}#{1,6}[ \t]+([^\n]+?)(?:[ \t]+#+[ \t]*)?(?:\n|$)/u.exec(
        body,
      );
    if (heading) {
      const rest = body.slice(heading[0].length);
      preview =
        heading[1].trim() === title.trim() ? rest : `${heading[1]}\n${rest}`;
    }
  }
  const position = token ? preview.toLocaleLowerCase().indexOf(token) : 0;
  const start = Math.max(0, position - 36);
  return `${start ? '…' : ''}${preview
    .slice(start, start + 150)
    .replace(/\s+/gu, ' ')
    .trim()}`;
}
