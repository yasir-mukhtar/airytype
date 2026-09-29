import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/publish/render';

describe('published Markdown rendering', () => {
  it('renders formatted structure without exposing Markdown syntax', () => {
    const html = renderMarkdown(
      '# Title\n\nSome *emphasis* and **strong** text with `code`.\n\n## Next\n\nFinal &copy; line.',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain(
      'Some <em>emphasis</em> and <strong>strong</strong> text with <code>code</code>.',
    );
    expect(html).toContain('<h2>Next</h2>');
    expect(html).toContain('©');
    expect(html).not.toContain('# Title');
  });

  it('renders lists, nested lists, and keeps ordered starts', () => {
    const html = renderMarkdown(
      '- one\n- two\n  - nested\n\n4. fourth\n5. fifth\n',
    );
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two<ul>');
    expect(html).toContain('<ol start="4">');
  });

  it('wraps loose-list items in paragraphs', () => {
    const html = renderMarkdown('- one\n\n- two\n');
    expect(html).toContain('<li><p>one</p>');
  });

  it('renders blockquotes, rules, and code blocks escaped', () => {
    const html = renderMarkdown(
      '> quoted *words*\n\n---\n\n```js\nconst x = 1 < 2;\n```\n',
    );
    expect(html).toContain('<blockquote>');
    expect(html).toContain('quoted <em>words</em>');
    expect(html).toContain('<hr>');
    expect(html).toContain('class="language-js"');
    expect(html).toContain('const x = 1 &lt; 2;');
  });

  it('links only safe destinations and opens them externally', () => {
    const html = renderMarkdown(
      '[good](https://example.com) [mail](mailto:a@b.co) [bad](javascript:alert(1)) [file](file:///etc) [rel](/docs/x)',
    );
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="mailto:a@b.co"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain('javascript:alert');
    expect(html).not.toContain('href="file:');
    expect(html).toContain(' bad ');
    expect(html).not.toContain('>bad</a>');
    expect(html).toContain('href="/docs/x"');
  });

  it('resolves reference-style links and their titles', () => {
    const html = renderMarkdown(
      'See [the docs][d] here.\n\n[d]: https://docs.example "Docs"\n',
    );
    expect(html).toContain('<a href="https://docs.example" title="Docs"');
    expect(html).not.toContain('LinkReference');
  });

  it('renders autolinks and email autolinks', () => {
    const html = renderMarkdown('<https://auto.example> and <a@b.co>');
    expect(html).toContain('href="https://auto.example"');
    expect(html).toContain('href="mailto:a@b.co"');
  });

  it('never executes raw HTML — it is shown as text', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> stays literal.\n',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x');
  });

  it('renders safe images and degrades unsafe ones to alt text', () => {
    const html = renderMarkdown(
      '![flower](https://img.example/f.png "cap") ![x](javascript:alert(1))',
    );
    expect(html).toContain('src="https://img.example/f.png"');
    expect(html).toContain('alt="flower"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('<span class="image-alt">x</span>');
  });

  it('honors escapes, entities, and hard breaks', () => {
    const html = renderMarkdown('a \\*literal\\* b  \nnext &hellip; &#33;');
    expect(html).toContain('a *literal* b<br>');
    expect(html).toContain('next … !');
  });

  it('renders setext headings and inline code with newlines', () => {
    const html = renderMarkdown('Heading\n=====\n\n`a\nb` after\n');
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<code>a b</code>');
  });
});
