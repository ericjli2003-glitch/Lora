import OpenAI from 'openai';

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }
  return client;
}

const SYSTEM_PROMPT = `You are a fact-checker. Analyze the given claim and determine its accuracy.

Respond in this exact JSON format:
{
  "verdict": "true" | "false" | "partially_true" | "unverifiable",
  "confidence": <number 0-100>,
  "explanation": "<brief explanation of your reasoning>"
}

Verdicts:
- "true": The claim is accurate and supported by evidence
- "false": The claim is inaccurate or contradicted by evidence
- "partially_true": The claim contains some truth but is misleading or incomplete
- "unverifiable": Cannot be verified with available information

Be concise. Focus on factual accuracy.`;

export async function checkWithOpenAI(text) {
  try {
    const openai = getClient();
    if (!openai) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Fact-check this claim:\n\n"${text}"` }
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from OpenAI');
    }

    return JSON.parse(content);
    
  } catch (err) {
    console.error('[OpenAI Error]', err.message || err);
    throw new Error(`OpenAI failed: ${err.message || 'Unknown error'}`);
  }
}
