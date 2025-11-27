import Anthropic from '@anthropic-ai/sdk';

let client = null;

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }
  return client;
}

const SYSTEM_PROMPT = `You are a fact-checker. Analyze the given claim and determine its accuracy.

Respond in this exact JSON format only, no other text:
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

export async function checkWithAnthropic(text) {
  try {
    const anthropic = getClient();
    if (!anthropic) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Fact-check this claim:\n\n"${text}"` }
      ]
    });

    const content = response.content[0]?.text;
    if (!content) {
      throw new Error('No response content from Anthropic');
    }

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse Anthropic response as JSON');
    }

    return JSON.parse(jsonMatch[0]);
    
  } catch (err) {
    console.error('[Anthropic Error]', err.message || err);
    throw new Error(`Anthropic failed: ${err.message || 'Unknown error'}`);
  }
}
