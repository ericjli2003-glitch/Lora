/**
 * LORA — UNIFIED ULTRA-FAST PIPELINE
 * 
 * OPTIMIZED FOR SPEED:
 * - Single LLM call does: Segment + Classify + Fact-Check + Generate Response
 * - Memory cache for instant repeats
 * - ~1-2 seconds total (down from 4-5 seconds)
 */

import { batchLookup, batchStore, getMemoryStats, lookupClaim } from './claimMemory.js';

// =============================================================================
// LAZY LOAD AI CLIENT
// =============================================================================

let openaiClient = null;

async function getOpenAI() {
  if (!openaiClient) {
    const { default: OpenAI } = await import('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// =============================================================================
// UNIFIED PROMPT - Does EVERYTHING in one call
// =============================================================================

const UNIFIED_PROMPT = `You are Lora, a warm AI fact-checker. Analyze the input and respond in ONE JSON object.

YOUR TASK:
1. Split the input into atomic segments (each containing one idea/claim)
2. Classify each segment: PERSONAL, FACTUAL, NONSENSE, or HARMFUL
3. Fact-check any FACTUAL/NONSENSE/HARMFUL segments (credibility 0-100)
4. Generate friendly responses

CLASSIFICATION RULES:
- PERSONAL: feelings, preferences, anecdotes ("I feel happy", "my friend bought pizza")
- FACTUAL: verifiable claims about the world (can be true OR false)
- NONSENSE: physically impossible ("gravity turned off")
- HARMFUL: could cause harm if believed ("drink bleach to cure X")

RESPOND WITH THIS EXACT JSON STRUCTURE:
{
  "segments": [
    {
      "text": "the original segment text",
      "type": "PERSONAL|FACTUAL|NONSENSE|HARMFUL",
      "credibility": null for PERSONAL, 0-100 for others,
      "explanation": null for PERSONAL, brief fact-check result for others
    }
  ],
  "hasPersonal": true/false,
  "hasFactual": true/false,
  "hasHarmful": true/false,
  "overallCredibility": average of factual segments or null,
  "personalResponse": warm response to personal content or null,
  "factCheckSummary": summary of fact-check results or null,
  "siriResponse": SHORT 1-2 sentence spoken response for voice assistant,
  "overallMessage": friendly combined response
}

RULES:
- siriResponse must be SHORT and speakable (no emoji)
- If harmful content, prioritize warning
- Be warm and conversational, not robotic
- Include specific credibility percentages when relevant`;

// =============================================================================
// UNIFIED PIPELINE
// =============================================================================

/**
 * Run the unified Lora pipeline - SINGLE LLM CALL
 */
export async function runUnifiedPipeline(input, options = {}) {
  const startTime = performance.now();
  
  // Validate
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return {
      success: false,
      error: null, // No hardcoded message
      errorType: 'empty_input',
      timings: { totalMs: 0 }
    };
  }

  // Check full-input cache first (instant response for repeated queries)
  const cacheKey = input.trim().toLowerCase();
  const cached = lookupClaim(cacheKey);
  if (cached.hit) {
    return {
      success: true,
      ...cached.data,
      fromCache: true,
      cacheType: 'full_input',
      timings: { totalMs: (performance.now() - startTime).toFixed(2) }
    };
  }

  try {
    const openai = await getOpenAI();
    
    // SINGLE LLM CALL - does everything
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: UNIFIED_PROMPT },
        { role: 'user', content: `Analyze this:\n\n"${input}"` }
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    const elapsed = performance.now() - startTime;

    // Determine mode
    let mode;
    if (result.hasHarmful) {
      mode = 'harmful_detected';
    } else if (result.hasPersonal && result.hasFactual) {
      mode = 'mixed';
    } else if (result.hasPersonal) {
      mode = 'personal';
    } else if (result.hasFactual) {
      mode = 'fact_check';
    } else {
      mode = 'empty';
    }

    // Build response
    const finalResult = {
      success: true,
      mode,
      
      // Summary
      summary: {
        totalSegments: result.segments?.length || 0,
        personal: result.segments?.filter(s => s.type === 'PERSONAL').length || 0,
        factual: result.segments?.filter(s => s.type === 'FACTUAL').length || 0,
        nonsense: result.segments?.filter(s => s.type === 'NONSENSE').length || 0,
        harmful: result.segments?.filter(s => s.type === 'HARMFUL').length || 0,
        overallCredibility: result.overallCredibility
      },
      
      // Harmful warning
      harmfulWarning: result.hasHarmful ? {
        detected: true,
        claims: result.segments?.filter(s => s.type === 'HARMFUL').map(s => s.text) || []
      } : null,
      
      // Responses (all LLM-generated)
      personalResponse: result.personalResponse,
      factCheckResponse: result.factCheckSummary,
      factCheckScore: result.overallCredibility,
      
      // Detailed analysis
      analysis: result.segments || [],
      
      // Messages
      loraMessage: result.overallMessage,
      siriResponse: result.siriResponse,
      
      // Performance
      timings: {
        totalMs: elapsed.toFixed(2),
        llmCalls: 1
      },
      
      fromCache: false
    };

    // Cache the full result
    batchStore([{ 
      segment: cacheKey, 
      normalized: cacheKey,
      credibility: result.overallCredibility || 0,
      ...finalResult
    }]);

    return finalResult;

  } catch (error) {
    console.error('[UnifiedPipeline] Error:', error.message);
    return {
      success: false,
      error: null,
      errorType: 'llm_error',
      timings: { totalMs: (performance.now() - startTime).toFixed(2) }
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { getMemoryStats };

export default {
  runUnifiedPipeline,
  getMemoryStats
};

