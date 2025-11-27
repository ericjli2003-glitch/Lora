import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI = null;

function getClient() {
  if (!genAI && process.env.GOOGLE_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }
  return genAI;
}

const EXTRACT_PROMPT = `Analyze this image and extract any claims, statements, or factual assertions that could be fact-checked.

Return a JSON object with:
{
  "claims": ["claim 1", "claim 2", ...],
  "mainClaim": "the most significant claim to fact-check",
  "context": "brief description of what the image shows"
}

Focus on factual claims, statistics, quotes, or assertions. Ignore opinions.
If no fact-checkable claims are found, return empty claims array.`;

const FACTCHECK_PROMPT = `You are a fact-checker. Analyze this image and determine if the claims or information shown are accurate.

Respond in this exact JSON format:
{
  "verdict": "true" | "false" | "partially_true" | "unverifiable",
  "confidence": <number 0-100>,
  "mainClaim": "the primary claim being made",
  "explanation": "brief explanation of your reasoning"
}

Be thorough but concise.`;

/**
 * Extract text/claims from an image
 */
export async function extractFromImage(base64Data, mimeType = 'image/png') {
  try {
    const client = getClient();
    if (!client) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const model = client.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
        responseMimeType: 'application/json'
      }
    });

    // Remove data URL prefix if present
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    const result = await model.generateContent([
      { text: EXTRACT_PROMPT },
      {
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64
        }
      }
    ]);

    const content = result.response.text();
    if (!content) {
      throw new Error('No response from Gemini');
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse image analysis');
    }

    return JSON.parse(jsonMatch[0]);

  } catch (err) {
    console.error('[Image Extract Error]', err.message || err);
    throw new Error(`Image extraction failed: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Fact-check an image directly
 */
export async function factCheckImage(base64Data, mimeType = 'image/png') {
  try {
    const client = getClient();
    if (!client) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const model = client.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1000,
        responseMimeType: 'application/json'
      }
    });

    // Remove data URL prefix if present
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');

    const result = await model.generateContent([
      { text: FACTCHECK_PROMPT },
      {
        inlineData: {
          mimeType: mimeType,
          data: cleanBase64
        }
      }
    ]);

    const content = result.response.text();
    if (!content) {
      throw new Error('No response from Gemini');
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse fact-check response');
    }

    return JSON.parse(jsonMatch[0]);

  } catch (err) {
    console.error('[Image Fact-Check Error]', err.message || err);
    throw new Error(`Image fact-check failed: ${err.message || 'Unknown error'}`);
  }
}

