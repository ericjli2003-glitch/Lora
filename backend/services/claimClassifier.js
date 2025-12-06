/**
 * Lora Max Performance - Claim Classifier
 * 
 * Classifies each segment as exactly ONE of:
 * - PERSONAL: relationships, feelings, subjective states
 * - FACTUAL: verifiable external facts
 * - NONSENSE: impossible/fantastical claims (still fact-checkable, score ~0)
 */

// =============================================================================
// CLASSIFICATION PATTERNS
// =============================================================================

// PERSONAL: Unverifiable internal/relational content
const PERSONAL_PATTERNS = [
  // First-person feelings/states
  /^i('m| am| feel| felt| think| believe| hope| wish| want| need| love| hate| like| prefer)/i,
  /^(my|our) (girlfriend|boyfriend|wife|husband|partner|friend|mom|dad|family|cat|dog|pet|boss|coworker)/i,
  
  // Subjective experiences
  /(makes me feel|made me feel|i experienced|my experience)/i,
  /^(today|yesterday|last night|this morning) (i|we|my)/i,
  
  // Opinions
  /^(in my opinion|imo|personally|i think that|i believe that)/i,
  /(is (the )?(best|worst|overrated|underrated)|my favorite)/i,
  
  // Relational/emotional content
  /(told me|asked me|gave me|showed me|texted me|called me)/i,
  /(so (happy|sad|excited|nervous|anxious|proud|grateful))/i,
  
  // Short reactions
  /^(lol|lmao|haha|omg|wtf|bruh|same|mood|vibes?|slay|periodt)$/i,
  /^[😂🤣💀😭❤️🔥👀✨]+$/,
  
  // Questions
  /^(what do you think|thoughts\?|anyone else|am i the only)/i,
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
  
  // Check length - very short is usually personal/reaction
  if (normalized.length < 15) {
    return {
      type: 'PERSONAL',
      confidence: 80,
      reason: 'too short to be a factual claim'
    };
  }
  
  // Check NONSENSE first (fantastical claims)
  for (const pattern of NONSENSE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        type: 'NONSENSE',
        confidence: 90,
        reason: 'contains fantastical or impossible claim'
      };
    }
  }
  
  // Check PERSONAL patterns
  for (const pattern of PERSONAL_PATTERNS) {
    if (pattern.test(text)) {
      return {
        type: 'PERSONAL',
        confidence: 85,
        reason: 'subjective/personal content'
      };
    }
  }
  
  // Check for FACTUAL indicators
  let factualScore = 0;
  const matchedIndicators = [];
  
  for (const pattern of FACTUAL_INDICATORS) {
    if (pattern.test(text)) {
      factualScore += 20;
      matchedIndicators.push(pattern.source.substring(0, 30));
    }
  }
  
  // Strong factual indicators
  if (factualScore >= 40) {
    return {
      type: 'FACTUAL',
      confidence: Math.min(95, 60 + factualScore),
      reason: 'contains verifiable factual claims'
    };
  }
  
  // Check for claim-like structure (X is Y, X causes Y, etc.)
  const claimStructure = /\b(is|are|was|were|has|have|had|can|will|does|do|did|causes?|leads? to|results? in)\b/i;
  if (claimStructure.test(text) && normalized.length > 30) {
    return {
      type: 'FACTUAL',
      confidence: 65,
      reason: 'statement structure suggests factual claim'
    };
  }
  
  // Default: lean toward personal for ambiguous content
  return {
    type: 'PERSONAL',
    confidence: 50,
    reason: 'ambiguous - defaulting to personal'
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

