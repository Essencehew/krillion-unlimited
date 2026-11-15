// Optional answer checker using Google's Gemini API (has a free tier).
// Set GEMINI_API_KEY in Vercel to enable. Without it the game still works,
// it just can't confirm brand-new answers (so they cap at DEEP CUT).

const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

export const aiEnabled = Boolean(KEY);

/**
 * Returns { valid, canonical, est } or null if unavailable.
 */
export async function judgeAnswer(question, answer) {
  if (!KEY) return null;
  const instructions =
    'You are the referee for a word game. Players answer a prompt; rarer valid answers score more. ' +
    'Decide if the player answer genuinely satisfies the prompt. Be lenient with spelling mistakes, ' +
    'regional or local names, slang for real things, and obscure-but-real answers. ' +
    'Reject gibberish, made-up things, answers that do not fit the prompt, and pure jokes. ' +
    'Also give the standard, correctly spelled name of the thing (lowercase), or "" if invalid, ' +
    'and estimate what percent of random players (0-100) would give this same answer to this prompt ' +
    '(the single most obvious answer might be 20-40, a decent but less obvious one 2-8, an obscure one under 0.5).';
  const body = {
    systemInstruction: { parts: [{ text: instructions }] },
    contents: [{ role: 'user', parts: [{ text: `Prompt: ${question}\nPlayer answer: ${answer}` }] }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 120,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          valid: { type: 'BOOLEAN' },
          canonical: { type: 'STRING' },
          estimatedPercent: { type: 'NUMBER' },
        },
        required: ['valid', 'canonical', 'estimatedPercent'],
      },
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4500),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const parsed = JSON.parse(text);
    if (typeof parsed.valid !== 'boolean') return null;
    const est = Number(parsed.estimatedPercent);
    return {
      valid: parsed.valid,
      canonical: String(parsed.canonical || '').slice(0, 60),
      est: Number.isFinite(est) ? Math.max(0, Math.min(40, est)) : null,
    };
  } catch {
    return null;
  }
}
