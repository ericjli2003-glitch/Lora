/**
 * Lora — Semantic Claim Classifier
 * 
 * NO REGEX. NO HARDCODED PATTERNS.
 * Uses LLM semantic reasoning to classify segments.
 * 
 * Classifications:
 * - PERSONAL: internal states, preferences, unverifiable anecdotes
 * - FACTUAL: externally verifiable claims about the world
 * - NONSENSE: contradicts physical reality
 * - HARMFUL: could cause physical harm if believed
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
// SEMANTIC CLASSIFICATION PROMPT
// =============================================================================

const CLASSIFICATION_PROMPT = `You are a semantic claim classifier. For each segment, determine its type based on MEANING, not keywords.

CLASSIFICATION TYPES:

1. PERSONAL - Internal states, subjective experiences, preferences, unverifiable anecdotes
   Examples: "I feel happy", "my girlfriend bought me pizza", "I like coffee", "this seems cool"

2. FACTUAL - Asserts something externally verifiable about the world
   Examples: "The Eiffel Tower is in Paris", "Einstein invented the lightbulb", "Vaccines cause autism", "The earth is flat"
   NOTE: A claim can be FALSE and still be FACTUAL (it's verifiable, just wrong)

3. NONSENSE - Contradicts basic physical reality (impossible claims)
   Examples: "Gravity turned off", "I flew to the moon by jumping", "The sun is made of ice cream"

4. HARMFUL - Could cause physical harm if believed/acted upon
   Examples: "Drinking bleach cures COVID", "You don't need seatbelts", "Eat raw chicken for protein"

RULES:
- Classify based on MEANING, not specific words
- "My friend said X" where X is a factual claim → FACTUAL (the embedded claim matters)
- "I heard that X" where X is verifiable → FACTUAL
- Short reactions like "lol", "omg", emoji → PERSONAL
- If unsure between FACTUAL and PERSONAL → choose FACTUAL (better to check than miss)
- HARMFUL claims are also FACTUAL but flagged for danger

Respond in JSON format:
{
  "classifications": [
    { "index": 0, "type": "FACTUAL", "reason": "asserts location of landmark" },
    { "index": 1, "type": "PERSONAL", "reason": "describes internal emotional state" }
  ]
}`;

// =============================================================================
// SEMANTIC CLASSIFICATION
// =============================================================================

/**
 * Classify segments using semantic reasoning (LLM-based)
 * @param {Array} segments - Array of { original, normalized } segments
 * @returns {Promise<Array>} Classified segments
 */
export async function classifySemanticBatch(segments) {
  if (!segments || segments.length === 0) {
    return { classified: [], stats: { total: 0 } };
  }

  const startTime = performance.now();
  
  try {
    const openai = await getOpenAI();
    
    // Build segment list for the prompt
    const segmentList = segments.map((seg, i) => 
      `${i}. "${seg.original || seg}"`
    ).join('\n');
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: CLASSIFICATION_PROMPT },
        { role: 'user', content: `Classify these segments:\n\n${segmentList}` }
      ],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    const classifications = result.classifications || [];
    
    // Map back to segments
    const classified = segments.map((segment, index) => {
      const classification = classifications.find(c => c.index === index);
      
      return {
        index,
        segment: segment.original || segment,
        normalized: segment.normalized || (segment.original || segment).toLowerCase().trim(),
        type: classification?.type?.toUpperCase() || 'FACTUAL', // Default to FACTUAL (better to check than miss)
        reason: classification?.reason || null,
        confidence: classification ? 85 : 50
      };
    });

    const elapsed = performance.now() - startTime;

    // Group by type
    const grouped = {
      PERSONAL: classified.filter(c => c.type === 'PERSONAL'),
      FACTUAL: classified.filter(c => c.type === 'FACTUAL'),
      NONSENSE: classified.filter(c => c.type === 'NONSENSE'),
      HARMFUL: classified.filter(c => c.type === 'HARMFUL')
    };

    return {
      classified,
      grouped,
      stats: {
        total: segments.length,
        personal: grouped.PERSONAL.length,
        factual: grouped.FACTUAL.length,
        nonsense: grouped.NONSENSE.length,
        harmful: grouped.HARMFUL.length,
        classificationTimeMs: elapsed.toFixed(2)
      }
    };

  } catch (error) {
    console.error('[SemanticClassifier] Error:', error.message);
    
    // Fallback: treat everything as FACTUAL (better to check than miss)
    const classified = segments.map((segment, index) => ({
      index,
      segment: segment.original || segment,
      normalized: segment.normalized || (segment.original || segment).toLowerCase().trim(),
      type: 'FACTUAL',
      reason: null, // No hardcoded reason
      confidence: 50,
      classificationFailed: true
    }));

    return {
      classified,
      grouped: { PERSONAL: [], FACTUAL: classified, NONSENSE: [], HARMFUL: [] },
      stats: { total: segments.length, personal: 0, factual: segments.length, nonsense: 0, harmful: 0, classificationFailed: true }
    };
  }
}

/**
 * Quick single-segment classification (for simple cases)
 */
export async function classifySingle(text) {
  const result = await classifySemanticBatch([{ original: text, normalized: text.toLowerCase() }]);
  return result.classified[0];
}

/**
 * Get segments that need fact-checking (FACTUAL + NONSENSE + HARMFUL)
 */
export function getCheckableSegments(classificationResult) {
  const { grouped } = classificationResult;
  return [
    ...grouped.FACTUAL, 
    ...grouped.NONSENSE, 
    ...grouped.HARMFUL
  ];
}

/**
 * Check if any segments are harmful (need warning)
 */
export function hasHarmfulContent(classificationResult) {
  return classificationResult.grouped.HARMFUL.length > 0;
}

export default {
  classifySemanticBatch,
  classifySingle,
  getCheckableSegments,
  hasHarmfulContent
};

