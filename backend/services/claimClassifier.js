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

// FACTUAL OVERRIDE: Pattern-based detection of CLAIM STRUCTURES (not specific entities)
// The AI models will fact-check the actual content - we just identify WHAT needs checking
const FACTUAL_OVERRIDE_PATTERNS = [
  // ===========================================
  // CLAIM STRUCTURE: "X is/are in Y" (location)
  // ===========================================
  /\b(is|are|was|were)\s+(in|located in|based in|built in|found in)\s+[A-Z]/i,
  /\b(the|a)\s+\w+\s+(is|are)\s+(in|at|on)\s+[A-Z]/i,
  
  // ===========================================
  // CLAIM STRUCTURE: "X [action verb] Y" (historical/achievement)
  // ===========================================
  /\b(invented|discovered|created|founded|built|wrote|composed|painted|designed)\b/i,
  /\b(failed|passed|graduated|dropped out|flunked)\b.{0,20}\b(math|school|class|college|university|exam|test)/i,
  /\b(born|died|lived|ruled|reigned)\b.{0,20}\b(in|on|at|during)\b/i,
  
  // ===========================================
  // CLAIM STRUCTURE: "X causes/cures/prevents Y" (causal)
  // ===========================================
  /\b(causes?|cures?|prevents?|treats?|kills?|heals?)\b.{0,30}\b(cancer|disease|illness|virus|infection|covid|death)/i,
  /\b(drinking|eating|taking|injecting|using)\b.{0,20}\b(cures?|kills?|prevents?|causes?)/i,
  
  // ===========================================
  // CLAIM STRUCTURE: "X is made of Y" (composition)
  // ===========================================
  /\b(is|are)\s+(made of|composed of|consists of|contains?)\b/i,
  
  // ===========================================
  // CLAIM STRUCTURE: "X is the [superlative]" (rankings)
  // ===========================================
  /\b(is|are|was|were)\s+the\s+(largest|smallest|tallest|oldest|youngest|first|last|only|fastest|slowest|richest|poorest|most|least)/i,
  
  // ===========================================
  // CLAIM STRUCTURE: Fact introducers
  // ===========================================
  /\bdid you know\b/i,
  /\bfun fact\b/i,
  /\bactually,?\s/i,
  /\bin fact\b/i,
  /\bthe truth is\b/i,
  
  // ===========================================
  // CLAIM STRUCTURE: Statistics & Numbers
  // ===========================================
  /\b\d+(\.\d+)?\s*%/,  // Any percentage
  /\b(million|billion|trillion|thousand)\b/i,
  /\b(studies?|research|data|evidence|scientists?|experts?)\s+(show|prove|confirm|found|suggest)/i,
  
  // ===========================================
  // CLAIM STRUCTURE: Scientific assertions
  // ===========================================
  /\b(proven|confirmed|disproven|debunked|verified)\b/i,
  /\b(according to|based on)\s+(research|studies|science|data|experts?)/i,
  
  // ===========================================
  // CLAIM STRUCTURE: Definitive external world claims
  // ===========================================
  /\b(is|are|was|were)\s+(true|false|real|fake|a myth|a hoax|a lie)\b/i,
  /\b(can|cannot|can't)\s+(be seen|be heard|survive|live|exist)\b/i,
  
  // ===========================================
  // CLAIM STRUCTURE: "The [noun] is [claim]" (definitive statements)
  // ===========================================
  /^the\s+[a-z]+\s+(is|are|was|were)\s+/i,
];

// PERSONAL: Pattern-based detection of PERSONAL/SUBJECTIVE content
// Only matches if NO factual override triggered
const PERSONAL_PATTERNS = [
  // ===========================================
  // STRUCTURE: "I feel/am [emotion]" (internal state)
  // ===========================================
  /^i('m| am| feel| felt)\s+(so\s+)?(happy|sad|excited|tired|hungry|bored|confused|nervous|anxious|grateful|blessed|lucky|angry|frustrated|overwhelmed)/i,
  /\bi('m| am) feeling\b/i,
  
  // ===========================================
  // STRUCTURE: "My [person] [personal action]" (relational)
  // ===========================================
  /^my\s+\w+\s+(bought|gave|made|sent|texted|called|told|asked|hugged|kissed|surprised|visited|cooked|baked)\s+(me|us)\b/i,
  /^(my|our)\s+(girlfriend|boyfriend|wife|husband|partner|friend|mom|dad|family|cat|dog|boss)\b/i,
  
  // ===========================================
  // STRUCTURE: "I [subjective verb]" (opinions/preferences)
  // ===========================================
  /^i\s+(love|hate|like|prefer|want|need|wish|hope|think|believe|feel like)\s+(this|that|it|my|the)\b/i,
  /^(in my opinion|imo|personally|tbh|honestly)\b/i,
  
  // ===========================================
  // STRUCTURE: Pure reactions (no claim content)
  // ===========================================
  /^(lol|lmao|haha|hehe|omg|wtf|bruh|same|mood|slay|periodt|yass|oof|wow|nice|cool|damn|yikes|ugh)$/i,
  /^[\u{1F300}-\u{1F9FF}\s]+$/u,  // Pure emoji
  
  // ===========================================
  // STRUCTURE: "Today/Yesterday I [personal action]"
  // ===========================================
  /^(today|yesterday|last night|this morning)\s+(i|we|my)\s+(went|saw|ate|met|had|got|did|tried|watched|played|hung out)/i,
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

