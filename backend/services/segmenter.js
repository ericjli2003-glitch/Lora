/**
 * Lora — Semantic Input Segmenter
 * 
 * NO HARDCODED PATTERNS. NO REGEX FOR CONTENT DETECTION.
 * Uses LLM semantic reasoning to segment input into atomic claims.
 */

// Lazy load OpenAI
let openaiClient = null;

async function getOpenAI() {
  if (!openaiClient) {
    const { default: OpenAI } = await import('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// =============================================================================
// SEMANTIC SEGMENTATION PROMPT
// =============================================================================

const SEGMENTATION_PROMPT = `You are a text segmenter. Your job is to split input into atomic segments, where each segment contains ONE distinct idea, claim, or statement.

RULES:
1. Each segment should be a complete thought that can stand alone
2. Separate personal statements from factual claims
3. Separate distinct claims even if they're in the same sentence
4. Preserve the original wording (don't paraphrase)
5. Handle chaotic/informal text (social media, slang, emoji) by extracting meaningful segments
6. Very short reactions or filler words can be grouped or omitted

EXAMPLES OF GOOD SEGMENTATION:

Input: "My girlfriend bought me pizza today. Also did you know Einstein failed math class? I feel so happy right now. The Eiffel Tower is in London."
Segments:
- "My girlfriend bought me pizza today"
- "Einstein failed math class"  
- "I feel so happy right now"
- "The Eiffel Tower is in London"

Input: "OMG wait 😱 scientists just confirmed the moon is cheese fr fr and also bleach cures covid my doc said so"
Segments:
- "scientists just confirmed the moon is cheese"
- "bleach cures covid"
- "my doc said so"

Respond in JSON:
{
  "segments": ["segment1", "segment2", ...],
  "inputStyle": "formal" | "casual" | "chaotic"
}`;

// =============================================================================
// SEMANTIC SEGMENTATION
// =============================================================================

/**
 * Segment input using LLM semantic reasoning
 * @param {string} text - Raw input text
 * @param {Object} options - Options
 * @returns {Promise<Object>} Segmentation result
 */
export async function segmentInput(text, options = {}) {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { segments: [], tikTokMode: false, metadata: {} };
  }

  const startTime = performance.now();

  try {
    const openai = await getOpenAI();

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SEGMENTATION_PROMPT },
        { role: 'user', content: `Segment this input:\n\n"${text}"` }
      ],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    const rawSegments = result.segments || [];
    const inputStyle = result.inputStyle || 'casual';

    // Build segment objects
    const segments = rawSegments
      .filter(seg => seg && seg.trim().length > 0)
      .map(seg => ({
        original: seg.trim(),
        normalized: seg.trim().toLowerCase(),
        length: seg.length
      }));

    const elapsed = performance.now() - startTime;

    return {
      segments,
      tikTokMode: inputStyle === 'chaotic',
      metadata: {
        inputLength: text.length,
        segmentCount: segments.length,
        inputStyle,
        segmentationTimeMs: elapsed.toFixed(2)
      }
    };

  } catch (error) {
    console.error('[Segmenter] Error:', error.message);
    
    // Fallback: simple sentence splitting (no semantic assumptions)
    const segments = text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(seg => ({
        original: seg,
        normalized: seg.toLowerCase(),
        length: seg.length
      }));

    return {
      segments,
      tikTokMode: false,
      metadata: {
        inputLength: text.length,
        segmentCount: segments.length,
        inputStyle: 'unknown',
        segmentationTimeMs: '0',
        fallback: true
      }
    };
  }
}

/**
 * Detect if input style is chaotic (for backwards compatibility)
 */
export function detectTikTokMode(text) {
  // This is now handled by the LLM in segmentInput
  // Keeping for backwards compatibility
  return { isTikTok: false, score: 0, indicators: {} };
}

/**
 * Normalize text (minimal - just for caching/matching)
 */
export function normalizeForFactCheck(text) {
  if (!text) return '';
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

export default {
  segmentInput,
  detectTikTokMode,
  normalizeForFactCheck
};
