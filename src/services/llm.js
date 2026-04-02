const fetch = require('node-fetch');
const config = require('../../config');

async function callLlm(systemPrompt, userContent, maxTokens = 150) {
  let model = config.LLM.MODEL;
  
  if (!model) {
    try {
      const res = await fetch(`${config.LLM.BASE_URL}/models`, { timeout: 3000 });
      const data = await res.json();
      if (data.data && data.data.length > 0) model = data.data[0].id;
    } catch (e) {
      model = '';
    }
  }

  const payload = {
    model,
    messages: [
      { role: 'system', content: systemPrompt + '\n\nIMPORTANT: Do NOT use <think/> tags. Reply directly with the answer only.' },
      { role: 'user', content: userContent }
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
    stop: ['<think', '<think/>', '<think >']
  };

  const res = await fetch(`${config.LLM.BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.LLM.API_KEY}`
    },
    body: JSON.stringify(payload),
    timeout: 30000
  });

  const result = await res.json();
  let text = result.choices[0].message.content.trim();
  text = text.replace(/<think.*?<\/\s*>/gs, '').trim();
  text = text.replace(/<think.*$/gs, '').trim();
  return text;
}

function cleanThinkTags(text) {
  return text.replace(/<think.*?<\/\s*>/gs, '').replace(/<think.*$/gs, '').trim();
}

module.exports = { callLlm, cleanThinkTags };