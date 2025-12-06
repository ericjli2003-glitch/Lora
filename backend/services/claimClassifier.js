/**
 * Lora Max Performance - Claim Classifier
 * 
 * Classifies each segment as exactly ONE of:
 * - PERSONAL: relationships, feelings, subjective states
 * - FACTUAL: verifiable external facts
 * - NONSENSE: impossible/fantastical claims (still fact-checkable, score ~0)
 * 
 * IMPORTANT: Factual claims ALWAYS override personal indicators!
 * "My doctor told me bleach cures COVID" → FACTUAL (the claim is checkable)
 */

// =============================================================================
// CLASSIFICATION PATTERNS
// =============================================================================

// FACTUAL OVERRIDE: These patterns ALWAYS trigger fact-checking regardless of personal markers
const FACTUAL_OVERRIDE_PATTERNS = [
  // Scientific claims
  /(scientist|study|research|proven|confirmed|discovered|evidence shows)/i,
  /(causes?|cures?|prevents?|treats?) .{3,30}(cancer|covid|disease|illness|virus)/i,
  
  // Health misinformation red flags
  /(vaccine|vaccination|ivermectin|hydroxychloroquine|bleach|miracle cure)/i,
  /(drinking|injecting|taking) .{0,20} (cures?|kills?|prevents?)/i,
  
  // Geographic/historical claims - EXPANDED
  /(tower|wall|building|monument|landmark|statue|bridge|palace|castle).{0,20}(is |are |in |located)/i,
  /(eiffel|big ben|statue of liberty|great wall|taj mahal|colosseum|pyramids?)/i,
  /\b(london|paris|tokyo|new york|rome|berlin|moscow|beijing|cairo)\b.{0,20}(is|has|was)/i,
  /(is|are|was|were) (in|the capital of|located in|built in|founded in)/i,
  /(capital of|located in|built in|founded in|is in)\s+\w+/i,
  
  // Famous people claims - EXPANDED
  /(einstein|newton|tesla|edison|shakespeare|mozart|picasso|darwin|galileo|curie|hawking)/i,
  /\b(failed|invented|discovered|said|wrote|created|born|died)\b.{0,30}(math|class|school|science)/i,
  /(did you know).{0,50}(einstein|famous|history|actually|really)/i,
  
  // "Did you know" fact patterns
  /did you know\s/i,
  /fun fact/i,
  
  // Astronomical/scientific facts
  /(moon|sun|earth|mars|planet|star) .{0,30} (is|are|made of|consists of)/i,
  /(flat earth|round earth|globe|space|nasa)/i,
  
  // Statistics and numbers
  /\b\d+(\.\d+)?%\s+(of|increase|decrease|rise|fall|drop)/i,
  
  // Definitive truth claims
  /(is (actually|really|truly)|the truth is|fact is)/i,
  /(visible from space|can be seen from)/i,
  
  // Explicit fact-check triggers
  /(is that true|is this true|is it true|true or false|myth or fact)/i,
];

// PERSONAL: Unverifiable internal/relational content (ONLY if no factual override)
const PERSONAL_PATTERNS = [
  // First-person feelings ONLY (not claims about the world)
  /^i('m| am) (so )?(happy|sad|excited|tired|hungry|bored|confused)$/i,
  /^i feel (so )?(happy|sad|good|bad|great|terrible)/i,
  
  // Pure personal anecdotes without factual claims
  /^(my|our) (girlfriend|boyfriend|wife|husband|partner|friend|mom|dad) (bought|gave|made|sent|texted|called|hugged|kissed)/i,
  
  // Pure opinions without external claims
  /^(in my opinion|imo|personally,? i think)$/i,
  /^i (love|hate|like|prefer) (this|that|it)$/i,
  
  // Short reactions ONLY
  /^(lol|lmao|haha|omg|wtf|bruh|same|mood|slay|periodt|yass|oof)$/i,
  /^[😂🤣💀😭❤️🔥👀✨🎉💯]+$/,
  
  // Questions that are just asking
  /^(what do you think|thoughts\?|anyone else feel this|am i the only one)$/i,
];

// NONSENSE: Fantastical/impossible claims
const NONSENSE_PATTERNS = [
  // Physical impossibilities
  /\b(flew to the moon without|breathe underwater without|lived for 1000 years|teleported|time travel)/i,
  /(unicorns? (are|is) real|dragons? exist|magic is real|flat earth.*confirmed)/i,
  
  // Supernatural claims
  /(ghost(s)? (are|is) proven|aliens? (have|has) been confirmed|bigfoot (was|is) captured)/i,
  /(psychic powers? (are|is) real|can read minds|can see the future)/i,
  
  // Obvious satire/exaggeration markers
  /(100% true story|totally happened|and then everyone clapped|that .* name\? albert einstein)/i,
  
  // Medical impossibilities
  /(cures? (all |every )?cancer|instant(ly)? (heal|cure)|immortal(ity)?( is)? (possible|achieved))/i,
  /(vaccine(s)? (contain|have) (microchip|5g|tracker))/i,
];

// FACTUAL: Verifiable external facts (should NOT match personal/nonsense first)
const FACTUAL_INDICATORS = [
  // Statistics/numbers
  /\b\d+(\.\d+)?%|\b\d{1,3}(,\d{3})+\b|\$\d+/,
  
  // Scientific/academic language
  /(study|research|scientist|professor|university|institute|according to|report|data|evidence|peer.?review)/i,
  
  // Geographic/historical facts
  /(located in|capital of|population of|founded in|discovered in|invented in)/i,
  /(in \d{4}|during the|century|war|president|government|country|nation)/i,
  
  // Health/science claims
  /(vaccine|virus|bacteria|disease|symptom|treatment|diagnosis|FDA|CDC|WHO)/i,
  /(causes?|prevents?|reduces?|increases?|affects?|impacts?) .{5,50} (risk|health|disease)/i,
  
  // News/current events
  /(announced|confirmed|reported|revealed|leaked|breaking|update)/i,
  
  // Definitive statements about external world
  /(is|are|was|were) (the |a )?(largest|smallest|first|last|only|oldest|newest)/i,
  /\b(fact|true|false|proven|disproven|myth|hoax)\b/i,
];

// =============================================================================
// CLASSIFICATION LOGIC
// =============================================================================

/**
 * Classify a single segment
 * @param {Object} segment - { original, normalized }
 * @returns {{ type: 'PERSONAL' | 'FACTUAL' | 'NONSENSE', confidence: number, reason: string }}
 */
export function classifySegment(segment) {
  const text = segment.original || segment;
  const normalized = segment.normalized || text.toLowerCase().trim();
  
  // =========================================
  // STEP 1: Check FACTUAL OVERRIDES FIRST
  // These ALWAYS trigger fact-checking!
  // =========================================
  for (const pattern of FACTUAL_OVERRIDE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        type: 'FACTUAL',
        confidence: 95,
        reason: 'contains verifiable claim that must be fact-checked'
      };
    }
  }
  
  // =========================================
  // STEP 2: Check NONSENSE (fantastical claims)
  // Still fact-checkable, just score ~0
  // =========================================
  for (const pattern of NONSENSE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        type: 'NONSENSE',
        confidence: 90,
        reason: 'contains fantastical or impossible claim'
      };
    }
  }
  
  // =========================================
  // STEP 3: Check for claim-like content
  // Any statement about the external world
  // =========================================
  
  // Check for FACTUAL indicators
  let factualScore = 0;
  
  for (const pattern of FACTUAL_INDICATORS) {
    if (pattern.test(text)) {
      factualScore += 25;
    }
  }
  
  // Strong factual indicators
  if (factualScore >= 25) {
    return {
      type: 'FACTUAL',
      confidence: Math.min(95, 60 + factualScore),
      reason: 'contains verifiable factual claims'
    };
  }
  
  // Check for claim-like structure (X is Y, X causes Y, etc.)
  const claimStructure = /\b(is|are|was|were|has|have|causes?|cures?|prevents?|leads? to|results? in|made of|located in|built in|invented|discovered|failed|confirmed)\b/i;
  if (claimStructure.test(text) && normalized.length > 20) {
    return {
      type: 'FACTUAL',
      confidence: 70,
      reason: 'statement structure suggests factual claim'
    };
  }
  
  // =========================================
  // STEP 4: Check PERSONAL (only pure personal)
  // =========================================
  
  // Very short content without claim structure
  if (normalized.length < 15) {
    return {
      type: 'PERSONAL',
      confidence: 75,
      reason: 'too short to be a factual claim'
    };
  }
  
  // Check pure personal patterns
  for (const pattern of PERSONAL_PATTERNS) {
    if (pattern.test(text)) {
      return {
        type: 'PERSONAL',
        confidence: 80,
        reason: 'subjective/personal content'
      };
    }
  }
  
  // =========================================
  // STEP 5: Default - lean toward FACTUAL
  // When in doubt, fact-check it!
  // =========================================
  if (normalized.length > 25) {
    return {
      type: 'FACTUAL',
      confidence: 55,
      reason: 'defaulting to factual - when in doubt, check it'
    };
  }
  
  return {
    type: 'PERSONAL',
    confidence: 50,
    reason: 'ambiguous short content'
  };
}

/**
 * Batch classify multiple segments
 * @param {Array} segments - Array of segment objects
 * @returns {Array} Classified segments with type and metadata
 */
export function classifyBatch(segments) {
  const startTime = performance.now();
  
  const classified = segments.map((segment, index) => {
    const classification = classifySegment(segment);
    return {
      index,
      segment: segment.original || segment,
      normalized: segment.normalized || (segment.original || segment).toLowerCase().trim(),
      ...classification
    };
  });
  
  const elapsed = performance.now() - startTime;
  
  // Group by type for easier processing
  const grouped = {
    PERSONAL: classified.filter(c => c.type === 'PERSONAL'),
    FACTUAL: classified.filter(c => c.type === 'FACTUAL'),
    NONSENSE: classified.filter(c => c.type === 'NONSENSE')
  };
  
  return {
    classified,
    grouped,
    stats: {
      total: segments.length,
      personal: grouped.PERSONAL.length,
      factual: grouped.FACTUAL.length,
      nonsense: grouped.NONSENSE.length,
      classificationTimeMs: elapsed.toFixed(2)
    }
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get segments that need fact-checking (FACTUAL + NONSENSE)
 */
export function getCheckableSegments(classificationResult) {
  const { grouped } = classificationResult;
  return [...grouped.FACTUAL, ...grouped.NONSENSE];
}

/**
 * Quick check if a segment should be fact-checked
 */
export function shouldFactCheck(segment) {
  const classification = classifySegment(segment);
  return classification.type === 'FACTUAL' || classification.type === 'NONSENSE';
}

export default {
  classifySegment,
  classifyBatch,
  getCheckableSegments,
  shouldFactCheck
};

