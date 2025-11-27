import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI = null;

function getClient() {
  if (!genAI && process.env.GOOGLE_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }
  return genAI;
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

export async function checkWithGoogle(text) {
  try {
    const client = getClient();
    if (!client) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const model = client.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
        responseMimeType: 'application/json'
      }
    });

    const prompt = `${SYSTEM_PROMPT}\n\nFact-check this claim:\n\n"${text}"`;
    const result = await model.generateContent(prompt);
    const response = result.response;
    const content = response.text();

    if (!content) {
      throw new Error('No response content from Google');
    }

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse Google response as JSON');
    }

    return JSON.parse(jsonMatch[0]);
    
  } catch (err) {
    console.error('[Google Error]', err.message || err);
    throw new Error(`Google failed: ${err.message || 'Unknown error'}`);
  }
}
