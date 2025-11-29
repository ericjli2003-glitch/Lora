import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';

let genAI = null;

function getClient() {
  if (!genAI && process.env.GOOGLE_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  }
  return genAI;
}

const SYSTEM_PROMPT = `You are a video fact-checker. Watch this video carefully and:

1. Identify the main claims or statements made
2. Evaluate each claim for accuracy
3. Provide an overall verdict

Respond in this exact JSON format:
{
  "claims": [
    {
      "claim": "<what was claimed>",
      "timestamp": "<approximate time in video>",
      "verdict": "true" | "false" | "partially_true" | "unverifiable",
      "explanation": "<why>"
    }
  ],
  "overallVerdict": "true" | "false" | "partially_true" | "unverifiable",
  "confidence": <number 0-100>,
  "summary": "<brief overall summary of the video's accuracy>"
}

Be thorough but concise.`;

/**
 * Analyze video from a URL
 */
export async function checkVideoFromURL(videoUrl) {
  try {
    const client = getClient();
    if (!client) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const model = client.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json'
      }
    });

    // Fetch video and convert to base64
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = response.headers.get('content-type') || 'video/mp4';

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
      {
        inlineData: {
          mimeType: mimeType,
          data: base64
        }
      }
    ]);

    const content = result.response.text();
    if (!content) {
      throw new Error('No response from Gemini');
    }

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse video analysis response');
    }

    return JSON.parse(jsonMatch[0]);

  } catch (err) {
    console.error('[Video Analysis Error]', err.message || err);
    throw new Error(`Video analysis failed: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Analyze video from base64 data
 */
export async function checkVideoFromBase64(base64Data, mimeType = 'video/mp4') {
  try {
    const client = getClient();
    if (!client) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    const model = client.getGenerativeModel({ 
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json'
      }
    });

    // Remove data URL prefix if present
    const cleanBase64 = base64Data.replace(/^data:video\/\w+;base64,/, '');

    const result = await model.generateContent([
      { text: SYSTEM_PROMPT },
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
      throw new Error('Could not parse video analysis response');
    }

    return JSON.parse(jsonMatch[0]);

  } catch (err) {
    console.error('[Video Analysis Error]', err.message || err);
    throw new Error(`Video analysis failed: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Generate spoken response from video analysis
 */
export function generateSpokenResponse(analysis) {
  const { overallVerdict, confidence, summary, claims } = analysis;
  const claimCount = claims?.length || 0;
  
  const verdictResponses = {
    true: `watched it and yeah it's legit, ${confidence}% confident`,
    false: `so I watched this and there's some bs in here, ${confidence}% sure it's not accurate`,
    partially_true: `eh it's a mix — some of it's true, some not so much (${confidence}% confidence)`,
    unverifiable: `couldn't fully verify everything in this video tbh`
  };

  const baseResponse = verdictResponses[overallVerdict] || `watched it but honestly not sure what to make of it`;
  
  return `${baseResponse}. found ${claimCount} claim${claimCount !== 1 ? 's' : ''} to look at. ${summary}`;
}

