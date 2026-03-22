const { fetchJson } = require('../utils/http');

const DEFAULT_SYSTEM_PROMPT =
  'You are Aryan AI, a tactical assistant inside THE PROTECTOR platform. Give concise, actionable safety and intelligence guidance. When uncertain, say what is unknown.';

async function chatWithAryan({ message, history = [] }) {
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) {
    return {
      text: 'HF_API_KEY is missing on the server. Add it in environment settings to activate Aryan AI.'
    };
  }

  const model = process.env.HF_CHAT_MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

  const messages = [
    { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
    ...history.slice(-8).map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: message }
  ];

  const payload = {
    model,
    messages,
    max_tokens: 350,
    temperature: 0.3
  };

  try {
    const completion = await fetchJson(
      'https://router.huggingface.co/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      },
      40000
    );

    const text = completion.choices?.[0]?.message?.content?.trim();

    if (text) {
      return { text, model };
    }
  } catch {
    // fallback below
  }

  try {
    // Legacy inference fallback for broad compatibility.
    const fallback = await fetchJson(
      `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ inputs: message, parameters: { max_new_tokens: 300, temperature: 0.3 } })
      },
      40000
    );

    const text =
      (Array.isArray(fallback) ? fallback[0]?.generated_text : fallback.generated_text || fallback[0]?.generated_text || '')
        ?.replace(message, '')
        .trim();

    if (text) {
      return { text, model };
    }
  } catch {
    // final fallback
  }

  return {
    text: 'Aryan AI is temporarily unavailable from Hugging Face. Please try again in a few seconds.',
    model
  };
}

module.exports = { chatWithAryan };