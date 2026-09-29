import '../assets/fonts/fonts.css';
import './published.css';
import {
  decodePublication,
  fetchPublication,
  type PublicationSnapshot,
} from './link';
import { renderMarkdown } from './render';

const dateLabel = (date: number) =>
  new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

/** Mirrors the notebook: a leading # equal to the note title is the title. */
function titleAppearsInBody(title: string, body: string): boolean {
  const heading = body
    .match(/^(?:[ \t]*\n)* {0,3}#[ \t]+([^\n]+?)(?:[ \t]+#+[ \t]*)?(?:\n|$)/)?.[1]
    ?.trim();
  return Boolean(heading && heading === title);
}

const root = document.getElementById('root')!;

function pageShell(): HTMLElement {
  const page = document.createElement('div');
  page.className = 'page';
  const foot = document.createElement('p');
  foot.className = 'page-foot';
  foot.textContent = 'Published with AiryType';
  root.append(page);
  page.append(foot);
  return page;
}

function unavailable(copy?: string): void {
  document.title = 'AiryType — Published note';
  const page = pageShell();
  const sheet = document.createElement('article');
  sheet.className = 'sheet sheet-unavailable';
  const header = document.createElement('header');
  header.className = 'sheet-header';
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.append('airytype');
  const dot = document.createElement('span');
  dot.className = 'brand-dot';
  dot.textContent = '.';
  brand.append(dot);
  header.append(brand);
  const h1 = document.createElement('h1');
  h1.className = 'doc-title';
  h1.textContent = 'This page isn’t available';
  const message = document.createElement('p');
  message.className = 'unavailable-copy';
  message.textContent =
    copy ??
    'The link may be incomplete, revoked, or damaged. Ask the writer to publish a fresh copy of the note.';
  sheet.append(header, h1, message);
  page.prepend(sheet);
}

function renderPage(snapshot: PublicationSnapshot): void {
  const title = snapshot.title.trim() || 'Untitled';
  const showsOwnTitle = titleAppearsInBody(snapshot.title, snapshot.body);
  document.title = `${title} — AiryType`;
  const page = pageShell();
  const article = document.createElement('article');
  article.className = 'sheet';
  const header = document.createElement('header');
  header.className = 'sheet-header';
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.append('airytype');
  const dot = document.createElement('span');
  dot.className = 'brand-dot';
  dot.textContent = '.';
  brand.append(dot);
  const tag = document.createElement('span');
  tag.className = 'publish-tag';
  tag.textContent = 'Published note';
  header.append(brand, tag);
  article.append(header);
  if (!showsOwnTitle || !snapshot.title.trim()) {
    const h1 = document.createElement('h1');
    h1.className = 'doc-title';
    h1.textContent = title;
    article.append(h1);
  }
  const byline = document.createElement('p');
  byline.className = 'doc-byline';
  byline.textContent = snapshot.publishedAt
    ? `Shared ${dateLabel(snapshot.publishedAt)} · Read-only`
    : 'Read-only';
  article.append(byline);
  const content = document.createElement('div');
  content.className = 'doc-content';
  content.innerHTML = renderMarkdown(snapshot.body);
  article.append(content);
  page.prepend(article);
}

const ref = decodePublication(window.location.hash);
if (!ref) {
  unavailable();
} else if (ref.kind === 'embedded') {
  renderPage(ref.snapshot);
} else {
  void fetchPublication(ref.token).then((snapshot) => {
    if (snapshot) renderPage(snapshot);
    else
      unavailable(
        'This note may have been revoked or the link is damaged. Ask the writer to publish a fresh copy.',
      );
  });
}
