import { parser } from '@lezer/markdown';
import type { SyntaxNode, Tree } from '@lezer/common';

/**
 * Renders a Markdown snapshot to sanitized HTML for the public read page.
 * Uses the same CommonMark parser as the writing surface, so published
 * output matches what the editor's quiet presentation conveys.
 *
 * Everything the parser marks is emitted as structure; literal text is always
 * escaped, raw HTML is shown as text, and link/image destinations are limited
 * to safe schemes.
 */
export function renderMarkdown(source: string): string {
  return new Renderer(source).render(parser.parse(source));
}

const LINK_ATTRS = ' target="_blank" rel="nofollow noopener noreferrer"';

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const referenceKey = (label: string) =>
  label.slice(1, -1).trim().replace(/\s+/g, ' ').toLowerCase();

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  middot: '·',
  sect: '§',
  para: '¶',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  bull: '•',
  dagger: '†',
  Dagger: '‡',
  permil: '‰',
  prime: '′',
  Prime: '″',
  lsaquo: '‹',
  rsaquo: '›',
  oline: '‾',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  curren: '¤',
  brvbar: '¦',
  uml: '¨',
  ordf: 'ª',
  ordm: 'º',
  shy: '­',
  macr: '¯',
  acute: '´',
  micro: 'µ',
  sup1: '¹',
  sup2: '²',
  sup3: '³',
  frac14: '¼',
  frac12: '½',
  frac34: '¾',
  iexcl: '¡',
  iquest: '¿',
  Agrave: 'À',
  Aacute: 'Á',
  Acirc: 'Â',
  Atilde: 'Ã',
  Auml: 'Ä',
  Aring: 'Å',
  AElig: 'Æ',
  Ccedil: 'Ç',
  Egrave: 'È',
  Eacute: 'É',
  Ecirc: 'Ê',
  Euml: 'Ë',
  Igrave: 'Ì',
  Iacute: 'Í',
  Icirc: 'Î',
  Iuml: 'Ï',
  ETH: 'Ð',
  Ntilde: 'Ñ',
  Ograve: 'Ò',
  Oacute: 'Ó',
  Ocirc: 'Ô',
  Otilde: 'Õ',
  Ouml: 'Ö',
  Oslash: 'Ø',
  Ugrave: 'Ù',
  Uacute: 'Ú',
  Ucirc: 'Û',
  Uuml: 'Ü',
  Yacute: 'Ý',
  THORN: 'Þ',
  szlig: 'ß',
  agrave: 'à',
  aacute: 'á',
  acirc: 'â',
  atilde: 'ã',
  auml: 'ä',
  aring: 'å',
  aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è',
  eacute: 'é',
  ecirc: 'ê',
  euml: 'ë',
  igrave: 'ì',
  iacute: 'í',
  icirc: 'î',
  iuml: 'ï',
  eth: 'ð',
  ntilde: 'ñ',
  ograve: 'ò',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  ouml: 'ö',
  oslash: 'ø',
  ugrave: 'ù',
  uacute: 'ú',
  ucirc: 'û',
  uuml: 'ü',
  yacute: 'ý',
  thorn: 'þ',
  yuml: 'ÿ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  lrm: '‎',
  rlm: '‏',
  dash: '‐',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  ldquo: '“',
  rdquo: '”',
  bdquo: '„',
  larr: '←',
  uarr: '↑',
  rarr: '→',
  darr: '↓',
  harr: '↔',
  infin: '∞',
  ne: '≠',
  le: '≤',
  ge: '≥',
  asymp: '≈',
  sum: '∑',
  prod: '∏',
  part: '∂',
  int: '∫',
  radic: '√',
  hearts: '♥',
  diams: '♦',
  clubs: '♣',
  spades: '♠',
};

function decodeEntity(source: string): string {
  const body = source.slice(1, -1); // strip & and ;
  if (body.startsWith('#x') || body.startsWith('#X')) {
    const code = Number.parseInt(body.slice(2), 16);
    return Number.isFinite(code) && code > 0
      ? String.fromCodePoint(code)
      : source;
  }
  if (body.startsWith('#')) {
    const code = Number.parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0
      ? String.fromCodePoint(code)
      : source;
  }
  return ENTITIES[body] ?? source;
}

const stripUnsafe = (raw: string) =>
  [...raw].filter((char) => char.charCodeAt(0) > 0x20).join('');

/** Destinations allowed on a public page; everything else loses its link. */
function safeLink(raw: string): string | null {
  const url = stripUnsafe(raw);
  if (/^(?:https?|mailto):/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null; // javascript:, data:, file:…
  return url || null; // anchor or relative reference
}

function safeImageSource(raw: string): string | null {
  const url = stripUnsafe(raw);
  if (/^https:/i.test(url)) return url;
  if (
    /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,[a-z0-9+/=]+$/i.test(url)
  )
    return url;
  return null;
}

const EMAIL_LIKE = /^[^\s@:]+@[^\s@:]+\.[^\s@:]+$/;
const BLANK_LINE = /\n[ \t]*\n/;
const MARKS = new Set([
  'EmphasisMark',
  'CodeMark',
  'HeaderMark',
  'LinkMark',
  'QuoteMark',
  'ListMark',
]);

class Renderer {
  private references = new Map<string, { url: string; title: string | null }>();

  constructor(private source: string) {}

  private slice(from: number, to: number): string {
    return this.source.slice(from, to);
  }

  render(tree: Tree): string {
    // Reference definitions must be collected before links resolve.
    tree.iterate({
      enter: ({ node, name }) => {
        if (name !== 'LinkReference') return;
        const label = node.getChild('LinkLabel');
        const url = node.getChild('URL');
        if (label && url) {
          const key = referenceKey(this.slice(label.from, label.to));
          if (!this.references.has(key)) {
            const title = node.getChild('LinkTitle');
            this.references.set(key, {
              url: this.slice(url.from, url.to),
              title: title ? this.slice(title.from + 1, title.to - 1) : null,
            });
          }
        }
        return false;
      },
    });
    return this.blocks(tree.topNode);
  }

  private blocks(node: SyntaxNode): string {
    let html = '';
    for (let child = node.firstChild; child; child = child.nextSibling)
      html += this.block(child);
    return html;
  }

  private block(node: SyntaxNode): string {
    const name = node.name;
    const heading = /^(ATXHeading|SetextHeading)([1-6])$/.exec(name);
    if (heading) {
      const level = heading[2];
      return `<h${level}>${this.inlineChildren(node).trim()}</h${level}>\n`;
    }
    switch (name) {
      case 'Paragraph':
        return `<p>${this.inlineChildren(node)}</p>\n`;
      case 'Blockquote':
        return `<blockquote>\n${this.blocks(node)}</blockquote>\n`;
      case 'BulletList':
        return this.list(node, 'ul');
      case 'OrderedList':
        return this.list(node, 'ol');
      case 'FencedCode':
      case 'CodeBlock':
        return this.codeBlock(node);
      case 'HorizontalRule':
        return '<hr>\n';
      case 'LinkReference':
        return '';
      case 'HTMLBlock': {
        const text = this.slice(node.from, node.to).replace(/\n+$/, '');
        return text ? `<p>${escapeHtml(text)}</p>\n` : '';
      }
      default:
        return this.blocks(node);
    }
  }

  private list(node: SyntaxNode, tag: 'ul' | 'ol'): string {
    const items = node.getChildren('ListItem');
    const loose = this.isLoose(items);
    let html = `<${tag}${this.startAttribute(node, tag)}>\n`;
    for (const item of items) {
      let content = '';
      for (let child = item.firstChild; child; child = child.nextSibling) {
        if (child.name === 'ListMark') continue;
        content +=
          !loose && child.name === 'Paragraph'
            ? this.inlineChildren(child)
            : this.block(child);
      }
      html += `<li>${content}</li>\n`;
    }
    return `${html}</${tag}>\n`;
  }

  /** A list is loose when items or inner blocks are separated by blank lines. */
  private isLoose(items: SyntaxNode[]): boolean {
    for (let index = 1; index < items.length; index++)
      if (BLANK_LINE.test(this.slice(items[index - 1].to, items[index].from)))
        return true;
    return items.some((item) => {
      const blocks: SyntaxNode[] = [];
      for (let child = item.firstChild; child; child = child.nextSibling)
        if (child.name !== 'ListMark') blocks.push(child);
      for (let index = 1; index < blocks.length; index++)
        if (
          BLANK_LINE.test(this.slice(blocks[index - 1].to, blocks[index].from))
        )
          return true;
      return false;
    });
  }

  private startAttribute(node: SyntaxNode, tag: 'ul' | 'ol'): string {
    if (tag !== 'ol') return '';
    const mark = node.firstChild?.getChild('ListMark');
    const start = mark
      ? Number.parseInt(this.slice(mark.from, mark.to), 10)
      : 1;
    return Number.isFinite(start) && start !== 1 ? ` start="${start}"` : '';
  }

  private codeBlock(node: SyntaxNode): string {
    const info = node.getChild('CodeInfo');
    const language = info ? this.slice(info.from, info.to).split(/\s+/)[0] : '';
    const text = node
      .getChildren('CodeText')
      .map((child) => this.slice(child.from, child.to))
      .join('\n');
    const className = language
      ? ` class="language-${escapeHtml(language)}"`
      : '';
    return `<pre><code${className}>${escapeHtml(text)}\n</code></pre>\n`;
  }

  /** Emits named children plus the anonymous text between them; drops marks. */
  private inlineChildren(node: SyntaxNode): string {
    let html = '';
    let cursor = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from > cursor)
        html += escapeHtml(this.slice(cursor, child.from));
      if (!MARKS.has(child.name)) html += this.inline(child);
      cursor = Math.max(cursor, child.to);
    }
    if (cursor < node.to) html += escapeHtml(this.slice(cursor, node.to));
    return html;
  }

  /** Same gap-filling walk bounded to [from, to) inside a node's children. */
  private inlineRange(node: SyntaxNode, from: number, to: number): string {
    let html = '';
    let cursor = from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.to <= from) continue;
      if (child.from >= to) break;
      if (child.from > cursor)
        html += escapeHtml(this.slice(cursor, Math.min(child.from, to)));
      if (!MARKS.has(child.name)) html += this.inline(child);
      cursor = Math.max(cursor, child.to);
    }
    if (cursor < to) html += escapeHtml(this.slice(cursor, to));
    return html;
  }

  private inline(node: SyntaxNode): string {
    switch (node.name) {
      case 'Emphasis':
        return `<em>${this.inlineChildren(node)}</em>`;
      case 'StrongEmphasis':
        return `<strong>${this.inlineChildren(node)}</strong>`;
      case 'InlineCode': {
        const marks = node.getChildren('CodeMark');
        const from = marks[0]?.to ?? node.from;
        const to = marks[marks.length - 1]?.from ?? node.to;
        return `<code>${escapeHtml(this.slice(from, to).replace(/\n/g, ' '))}</code>`;
      }
      case 'Link':
        return this.link(node, false);
      case 'Image':
        return this.link(node, true);
      case 'Autolink': {
        const url = node.getChild('URL');
        if (!url) return escapeHtml(this.slice(node.from, node.to));
        const text = this.slice(url.from, url.to);
        const href = EMAIL_LIKE.test(text) ? `mailto:${text}` : safeLink(text);
        if (!href) return escapeHtml(text);
        return `<a href="${escapeHtml(href)}"${LINK_ATTRS}>${escapeHtml(text)}</a>`;
      }
      case 'Escape':
        return escapeHtml(this.slice(node.from + 1, node.to));
      case 'Entity':
        return escapeHtml(decodeEntity(this.slice(node.from, node.to)));
      case 'HardBreak':
        return '<br>\n';
      case 'HTMLTag':
      case 'Comment':
      case 'ProcessingInstruction':
      case 'Declaration':
      case 'CDATA':
        return escapeHtml(this.slice(node.from, node.to));
      default:
        return node.firstChild
          ? this.inlineChildren(node)
          : escapeHtml(this.slice(node.from, node.to));
    }
  }

  private link(node: SyntaxNode, image: boolean): string {
    const marks = node.getChildren('LinkMark');
    const open = marks[0];
    const close = marks[1];
    if (!open || !close || close.from <= open.to)
      return escapeHtml(this.slice(node.from, node.to));
    const label = this.slice(open.to, close.from);
    const direct = node.getChild('URL');
    const reference = node.getChild('LinkLabel');
    const titleNode = node.getChild('LinkTitle');
    const resolved = direct
      ? {
          url: this.slice(direct.from, direct.to),
          title: titleNode
            ? this.slice(titleNode.from + 1, titleNode.to - 1)
            : null,
        }
      : this.references.get(
          referenceKey(
            reference ? this.slice(reference.from, reference.to) : `[${label}]`,
          ),
        );
    if (image) {
      const alt = escapeHtml(label.trim());
      const source = resolved ? safeImageSource(resolved.url) : null;
      if (!source) return alt ? `<span class="image-alt">${alt}</span>` : '';
      const title = resolved?.title
        ? ` title="${escapeHtml(resolved.title)}"`
        : '';
      return `<img src="${escapeHtml(source)}" alt="${alt}"${title} loading="lazy" decoding="async">`;
    }
    const inner = this.inlineRange(node, open.to, close.from);
    const href = resolved ? safeLink(resolved.url) : null;
    if (!href) return inner;
    const title = resolved?.title
      ? ` title="${escapeHtml(resolved.title)}"`
      : '';
    return `<a href="${escapeHtml(href)}"${title}${LINK_ATTRS}>${inner}</a>`;
  }
}
