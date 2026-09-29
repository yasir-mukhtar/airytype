import '../assets/fonts/fonts.css';
import './published.css';
import { decodePublication } from './link';
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
    .match(
      /^(?:[ \t]*\n)* {0,3}#[ \t]+([^\n]+?)(?:[ \t]+#+[ \t]*)?(?:\n|$)/,
    )?.[1]
    ?.trim();
  return Boolean(heading && heading === title);
}

const root = document.getElementById('root')!;
const snapshot = decodePublication(window.location.hash);

if (!snapshot) {
  document.title = 'AiryType — Published note';
  root.innerHTML = `
    <div class="page">
      <article class="sheet sheet-unavailable">
        <header class="sheet-header">
          <span class="brand">airytype<span class="brand-dot">.</span></span>
        </header>
        <h1 class="doc-title">This page isn’t available</h1>
        <p class="unavailable-copy">
          The link may be incomplete or damaged. Ask the writer to publish a
          fresh copy of the note.
        </p>
      </article>
      <p class="page-foot">Published with AiryType</p>
    </div>`;
} else {
  const title = snapshot.title.trim() || 'Untitled';
  const showsOwnTitle = titleAppearsInBody(snapshot.title, snapshot.body);
  document.title = `${title} — AiryType`;
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
  const page = document.createElement('div');
  page.className = 'page';
  page.append(article);
  const foot = document.createElement('p');
  foot.className = 'page-foot';
  foot.textContent = 'Published with AiryType';
  page.append(foot);
  root.append(page);
}
