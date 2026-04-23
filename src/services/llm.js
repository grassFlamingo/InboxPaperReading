const OpenAI = require('openai');
const config = require('../../config');

const openai = new OpenAI({
  baseURL: config.LLM.BASE_URL,
  apiKey: config.LLM.API_KEY,
});

async function callLlm(systemPrompt, userContent, maxTokens = undefined, glossary = '', options = {thinking: false}) {
  let model = config.LLM.MODEL;
  if (!maxTokens){
    maxTokens = config.LLM.DEFAULT_MAX_TOKENS || 1024;
  }

  if (!model) {
    try {
      const res = await openai.models.list({ timeout: 3000 });
      if (res.data && res.data.length > 0) model = res.data[0].id;
    } catch (e) {
      model = '';
    }
  }

  const glossaryNote = glossary ? '\n\n以下是术语参考（可选使用）：\n' + glossary + '\n' : '';
  const fullUserContent = userContent + glossaryNote;

  const messages = [
    { role: 'system', content: systemPrompt + '\n\nIMPORTANT: Do NOT use <think/> tags. Reply directly with the answer only.' },
    { role: 'user', content: fullUserContent }
  ];

  const extraBody = {};
  if (options.thinking === false) {
    extraBody.chat_template_kwargs = { thinking: false };
  }

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.3,
      stop: ['<think', '<think/>', '<think >'],
      ...(Object.keys(extraBody).length > 0 && { extra_body: extraBody })
    });

    let text = completion.choices[0].message.content.trim();
    text = text.replace(/<think.*?<\/\s*>/gs, '').trim();
    text = text.replace(/<think.*$/gs, '').trim();
    return text;
  } catch (e) {
    console.error('[LLM] API error:', e.message);
    throw e;
  }
}

function cleanThinkTags(text) {
  return text.replace(/<think.*?<\/\s*>/gs, '').replace(/<think.*$/gs, '').trim();
}

module.exports = { callLlm, cleanThinkTags };
