import { syntaxTree } from '@codemirror/language';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';

interface Presentation {
  tree: Tree;
  decorations: DecorationSet;
}

const mark = (className: string) => Decoration.mark({ class: className });
const marker = mark('airy-md-marker');
const hidden = Decoration.replace({});

// The Markdown parser also emits Link nodes for unresolved [brackets]. Only
// compact references that actually have a definition in this document.
const referenceKey = (label: string) =>
  label.slice(1, -1).trim().replace(/\s+/g, ' ').toLowerCase();

function selected(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.head >= from && range.head <= to
      : range.from < to && range.to > from,
  );
}

function present(state: EditorState): Presentation {
  const tree = syntaxTree(state);
  const ranges: Range<Decoration>[] = [];
  const references = new Map<string, string>();
  tree.iterate({
    enter({ node, name }) {
      if (name !== 'LinkReference') return;
      const label = node.getChild('LinkLabel');
      const url = node.getChild('URL');
      if (label && url) {
        const key = referenceKey(state.sliceDoc(label.from, label.to));
        if (!references.has(key))
          references.set(key, state.sliceDoc(url.from, url.to));
      }
      return false;
    },
  });
  const add = (decoration: Decoration, from: number, to: number) => {
    if (to > from) ranges.push(decoration.range(from, to));
  };
  const line = (from: number, className: string, style?: string) => {
    ranges.push(
      Decoration.line({
        class: className,
        attributes: style ? { style } : undefined,
      }).range(from),
    );
  };
  const compactLink = (node: SyntaxNode) => {
    const marks = node.getChildren('LinkMark');
    const open = marks[0];
    const close = marks[1];
    if (!open || !close || close.from <= open.to) return false;
    const url = node.getChild('URL');
    const label = node.getChild('LinkLabel');
    const inline = marks.some(
      (part) => state.sliceDoc(part.from, part.to) === '(',
    );
    const key =
      label && label.to - label.from > 2
        ? referenceKey(state.sliceDoc(label.from, label.to))
        : referenceKey(
            state.sliceDoc(
              open.from + (node.name === 'Image' ? 1 : 0),
              close.to,
            ),
          );
    const destination = url
      ? state.sliceDoc(url.from, url.to)
      : references.get(key);
    if (!inline && !destination) return false;
    const active = selected(state, node.from, node.to);
    add(
      Decoration.mark({
        class: `airy-link-label${node.name === 'Image' ? ' airy-image-label' : ''}`,
        attributes: {
          title: `${node.name === 'Image' ? 'Image: ' : ''}${destination ?? ''}\nPlace the caret here to edit the Markdown.`,
        },
      }),
      open.to,
      close.from,
    );
    if (!active) {
      add(hidden, node.from, open.to);
      add(hidden, close.from, node.to);
    } else {
      add(mark('airy-link-source'), close.from, node.to);
    }
    return true;
  };

  tree.iterate({
    enter({ node, name, from, to }) {
      if (/^(ATXHeading|SetextHeading)[1-6]$/.test(name)) {
        const level = name.at(-1)!;
        const first = state.doc.lineAt(from);
        line(first.from, `airy-heading airy-heading-${level}`);
        if (name.startsWith('ATX')) {
          const prefix = node.getChild('HeaderMark');
          if (prefix && /^\s*$/.test(state.sliceDoc(first.from, prefix.from))) {
            const spaces = /^\s*/.exec(state.sliceDoc(prefix.to, first.to))![0];
            const end = prefix.to + spaces.length;
            add(
              Decoration.mark({
                class: 'airy-heading-marker airy-md-marker',
                attributes: { style: `--marker-width: ${end - first.from}ch` },
              }),
              first.from,
              end,
            );
          }
        }
      }
      if ((name === 'Link' || name === 'Image') && !compactLink(node))
        return false;
      if (name === 'Autolink') {
        add(mark('airy-link-label'), from + 1, to - 1);
        if (!selected(state, from, to)) {
          add(hidden, from, from + 1);
          add(hidden, to - 1, to);
        }
      }
      if (name === 'FencedCode' || name === 'CodeBlock') {
        const first = state.doc.lineAt(from);
        const last = state.doc.lineAt(to);
        const fences = node.getChildren('CodeMark');
        for (let number = first.number; number <= last.number; number++) {
          const source = state.doc.line(number);
          const fence = fences.find(
            (part) => part.from >= source.from && part.to <= source.to,
          );
          const active = selected(state, source.from, source.to);
          line(
            source.from,
            [
              'airy-code-block',
              number === first.number ? 'airy-code-first' : '',
              number === last.number ? 'airy-code-last' : '',
              fence
                ? `airy-code-fence${active ? ' airy-code-fence-active' : ''}`
                : '',
            ]
              .filter(Boolean)
              .join(' '),
          );
          // Keep the language visible as a small label; reveal the exact fence
          // as soon as navigation or a search selection enters its source line.
          if (fence && !active) add(hidden, fence.from, fence.to);
        }
        return false; // Markdown-looking punctuation inside code is literal.
      }
      if (name === 'InlineCode') add(mark('airy-inline-code'), from, to);
      if (name === 'Blockquote') {
        for (
          let number = state.doc.lineAt(from).number;
          number <= state.doc.lineAt(to).number;
          number++
        )
          line(state.doc.line(number).from, 'airy-quote');
      }
      if (name === 'Escape') add(marker, from, from + 1);
      if (/^(EmphasisMark|CodeMark|HeaderMark|LinkMark|QuoteMark)$/.test(name))
        add(marker, from, to);
      if (name === 'QuoteMark') {
        const source = state.doc.lineAt(from);
        const prefix = /^(\s*>[ \t]*)+/.exec(source.text)?.[0];
        // One prefix decoration per line, including all nested quote markers.
        if (prefix && !source.text.slice(0, from - source.from).includes('>')) {
          const depth = (prefix.match(/>/g) ?? []).length;
          const style = `--prefix-width: ${depth * 18}px`;
          line(source.from, 'airy-hanging-line', style);
          add(
            mark('airy-block-prefix airy-md-marker'),
            source.from,
            source.from + prefix.length,
          );
        }
      }
      if (name === 'ListMark') {
        const source = state.doc.lineAt(from);
        const before = state.sliceDoc(source.from, from);
        if (/^[ \t]*$/.test(before)) {
          const spaces = /^[ \t]*/.exec(state.sliceDoc(to, source.to))![0];
          const end = to + spaces.length;
          const indent = before.replace(/\t/g, '    ').length;
          line(
            source.from,
            'airy-list-line airy-hanging-line',
            `--prefix-width: ${1.6 + indent * 0.5}em`,
          );
          add(mark('airy-block-prefix airy-list-prefix'), source.from, end);
        }
      }
      if (name === 'HorizontalRule')
        line(state.doc.lineAt(from).from, 'airy-rule');
      if (name === 'LinkReference')
        line(state.doc.lineAt(from).from, 'airy-reference');
    },
  });
  return { tree, decorations: Decoration.set(ranges, true) };
}

/** Presentation only. No rewritten source, cursor filtering, or atomic links. */
export const markdownPresentation = StateField.define<Presentation>({
  create: present,
  update(value, transaction) {
    if (
      transaction.docChanged ||
      transaction.selection ||
      syntaxTree(transaction.state) !== value.tree
    )
      return present(transaction.state);
    return value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.scrollMargins.of((view) => {
      let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(
        view.state.selection.main.head,
        1,
      );
      for (; node; node = node.parent) {
        if (/^(ATXHeading|SetextHeading)[1-3]$/.test(node.name))
          return { top: node.name.endsWith('1') ? 62 : 38 };
      }
      return null;
    }),
  ],
});
