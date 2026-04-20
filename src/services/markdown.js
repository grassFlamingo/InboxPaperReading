const { fetchUrlText } = require('./web');
const TurndownService = require('turndown');

const WEB_CONTENT_TYPES = ['wechat_article', 'blog_post', 'twitter_thread', 'other'];

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  strongDelimiter: '**',
  emDelimiter: '*',
});

turndownService.addRule('strikethrough', {
  filter: ['s', 'del', 'strike'],
  replacement: (content) => `~~${content}~~`,
});

turndownService.addRule('taskList', {
  filter: ['li'],
  replacement: (content) => {
    const checked = content.includes('[x]') || content.includes('[X]');
    return `${checked ? '[x]' : '[ ]'} ${content.replace(/\[.?\]/g, '').trim()}\n`;
  },
});

async function convertHtmlToMarkdown(url, htmlContent) {
  try {
    let html = htmlContent;
    html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
    html = html.replace(/<!--[\s\S]*?-->/g, '');
    html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
    html = html.replace(/<footer[\s\S]*?<\/footer>/gi, '');
    html = html.replace(/<header[\s\S]*?<\/header>/gi, '');
    return turndownService.turndown(html);
  } catch (e) {
    console.error('[html2markdown] Conversion failed:', e.message);
    return null;
  }
}

async function processMarkdownConversion(paper) {
  if (!paper.source_url) return { done: 0, msg: null };
  
  const sourceType = paper.source_type || 'paper';
  if (!WEB_CONTENT_TYPES.includes(sourceType)) {
    return { done: 0, msg: 'not web content' };
  }

  if (paper.markdown_content && paper.markdown_content.length > 100) {
    return { done: 0, msg: 'already converted' };
  }

  console.log(`[MD-Convert] Converting #${paper.id}: ${paper.title?.substring(0, 30)}`);
  
  const htmlContent = await fetchUrlText(paper.source_url, 15000);
  if (!htmlContent || htmlContent.length < 100) {
    return { done: 0, msg: 'fetch failed' };
  }

  const markdown = await convertHtmlToMarkdown(paper.source_url, htmlContent);
  if (!markdown || markdown.length < 50) {
    return { done: 0, msg: 'convert failed' };
  }

  const db = require('../db/database');
  db.runQuery('UPDATE papers SET markdown_content = ? WHERE id = ?', [markdown, paper.id]);

  return { done: 1, msg: `${markdown.length} chars` };
}

module.exports = { convertHtmlToMarkdown, processMarkdownConversion, WEB_CONTENT_TYPES };
