const SYSTEM_PROMPT = `You are a fact-checker with access to real-time information. Analyze the given claim and determine its accuracy.

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

Be concise. Focus on factual accuracy. Use your real-time search capabilities to verify claims.`;

export async function checkWithPerplexity(text) {
  try {
    if (!process.env.PERPLEXITY_API_KEY) {
      throw new Error('PERPLEXITY_API_KEY not configured');
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Fact-check this claim:\n\n"${text}"` }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No response content from Perplexity');
    }

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse Perplexity response as JSON');
    }

    return JSON.parse(jsonMatch[0]);
    
  } catch (err) {
    console.error('[Perplexity Error]', err.message || err);
    throw new Error(`Perplexity failed: ${err.message || 'Unknown error'}`);
  }
}
