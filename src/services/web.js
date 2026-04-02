const fetch = require('node-fetch');

async function fetchUrlText(url, maxChars = 6000) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };

  let text;
  try {
    const res = await fetch(url, { headers, timeout: 15000 });
    const raw = await res.buffer();
    for (const enc of ['utf-8', 'gbk', 'gb2312', 'latin-1']) {
      try { text = raw.toString(enc); break; } catch (e) { continue; }
    }
    if (!text) text = raw.toString('utf-8', { strict: false });
  } catch (e) {
    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });
    const res = await fetch(url, { headers, timeout: 15000, agent });
    text = res.buffer().toString('utf-8', { strict: false });
  }

  text = text.replace(/<(script|style|head)[^>]*>.*?<\/\1>/gis, ' ');
  
  const ogTitle = text.match(/og:title["\s]+content="([^"]+)"/i) || text.match(/content="([^"]+)"[^>]+og:title/i);
  const ogDesc = text.match(/og:description["\s]+content="([^"]+)"/i) || text.match(/content="([^"]+)"[^>]+og:description/i);
  const ogAuthor = text.match(/og:article:author["\s]+content="([^"]+)"/i) || text.match(/content="([^"]+)"[^>]+og:article:author/i);

  let metaInfo = '';
  if (ogTitle) metaInfo += `OG_TITLE: ${ogTitle[1]}\n`;
  if (ogDesc) metaInfo += `OG_DESCRIPTION: ${ogDesc[1]}\n`;
  if (ogAuthor) metaInfo += `OG_AUTHOR: ${ogAuthor[1]}\n`;

  text = text.replace(/<[^>]+>/g, ' ').replace(/&[a-z]{2,6};/g, ' ').replace(/\s{3,}/g, '\n').trim();
  return (metaInfo + text).substring(0, maxChars);
}

function detectSourceType(url) {
  const u = url.toLowerCase();
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter_thread';
  if (u.includes('mp.weixin.qq.com') || u.includes('weixin.qq.com')) return 'wechat_article';
  if (u.includes('arxiv.org')) return 'paper';
  if (['zhihu.com', 'medium.com', 'substack.com', 'huggingface.co/blog', 'openai.com/blog', 'anthropic.com/news', 'deepmind.google/blog'].some(d => u.includes(d))) return 'blog_post';
  if (u.includes('youtube.com') || u.includes('youtu.be') || u.includes('bilibili.com')) return 'video';
  if (['acm.org', 'ieee.org', 'nature.com', 'science.org', 'springer.com', 'openreview.net', 'semanticscholar.org'].some(d => u.includes(d))) return 'paper';
  return 'blog_post';
}

module.exports = { fetchUrlText, detectSourceType };