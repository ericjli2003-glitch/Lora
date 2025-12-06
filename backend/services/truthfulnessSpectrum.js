/**
 * Truthfulness Spectrum Module
 * 
 * Provides functionality for:
 * 1. Detecting personal vs fact-checkable statements
 * 2. Computing a 0-100% truthfulness score from model responses
 */

// =============================================================================
// Personal Statement Detection
// =============================================================================

/**
 * Detects if text is a personal/anecdotal statement that shouldn't be fact-checked
 * @param {string} text - The input text to analyze
 * @returns {{ isPersonal: boolean, reason: string, confidence: number }}
 */
export function detectPersonalStatement(text) {
  if (!text || typeof text !== 'string') {
    return { isPersonal: true, reason: 'invalid input', confidence: 100 };
  }

  const lower = text.toLowerCase().trim();
  
  // Empty or very short text
  if (lower.length === 0) {
    return { isPersonal: true, reason: 'empty input', confidence: 100 };
  }
  
  if (lower.length < 10) {
    return { isPersonal: true, reason: 'too short to be a factual claim', confidence: 80 };
  }

  // First-person anecdotal patterns
  const anecdotalPatterns = [
    /^my (girlfriend|boyfriend|wife|husband|partner|friend|mom|dad|mother|father|sister|brother|family|dog|cat|boss|coworker)/i,
    /my (girlfriend|boyfriend|wife|husband|partner|mom|dad) .*(bought|gave|told|asked|showed|sent|made)/i,
    /^(i|we) (just|recently|finally|actually)/i,
    /^today (i|we|my)/i,
    /^today i/i,
    /^yesterday (i|we|my)/i,
    /^last (night|week|month|year) (i|we|my)/i,
    /^(i|we) (went|saw|met|had|got|made|did|tried|bought|found|learned|discovered)/i,
    /(told me|asked me|gave me|bought me|showed me|sent me)/i,
    /^so basically/i,
    /^you know what/i,
    /^guess what/i,
    /^i went to/i,
    /^i saw/i,
  ];

  // Emotional statement patterns
  const emotionalPatterns = [
    /^i'm (so |really |very )?(happy|sad|angry|excited|nervous|anxious|scared|worried|tired|exhausted|confused|frustrated|grateful|thankful|blessed|lucky)/i,
    /^i am (so |really |very )?(happy|sad|angry|excited|nervous|anxious|scared|worried|tired|exhausted|confused|frustrated|grateful|thankful|blessed|lucky)/i,
    /^i feel/i,
    /^i felt/i,
    /i('m| am) feeling/i,
    /(made my day|broke my heart|can't believe|i love this|i hate this|i miss|i wish)/i,
    /(this made my day)/i,
    /(feeling (good|bad|great|terrible|amazing|awful|sad|happy))/i,
    /^(omg|oh my god|wtf|lol|lmao|haha|bruh|bro|dude)/i,
    /^lol/i,
    /^haha/i,
    /i can'?t believe/i,
  ];

  // Non-claim content patterns
  const nonClaimPatterns = [
    /^(lol|lmao|haha|hehe)+$/i,
    /^[😂🤣💀😭\s]+$/,  // Only emojis
    /^[\u{1F300}-\u{1F9FF}\s]*$/u,  // Only emojis/symbols
    /^[^\w]*$/,  // Only symbols/punctuation
    /^(hi|hey|hello|sup|yo|what's up)/i,
    /^(thanks|thank you|thx|ty)/i,
    /^(ok|okay|k|sure|yeah|yep|nope|nah)$/i,
    /^(good morning|good night|gn|gm)/i,
  ];

  // Opinion patterns (not fact-checkable)
  const opinionPatterns = [
    /^i think/i,
    /^i believe/i,
    /^in my opinion/i,
    /^imo/i,
    /^personally/i,
    /^i prefer/i,
    /^i like|i love|i hate/i,
    /(is (the )?(best|worst|overrated|underrated))/i,
    /^(do you think|what do you think|thoughts\?)/i,
  ];

  // Check anecdotal patterns
  for (const pattern of anecdotalPatterns) {
    if (pattern.test(lower)) {
      return {
        isPersonal: true,
        reason: 'anecdotal/personal story',
        confidence: 85
      };
    }
  }

  // Check emotional patterns
  for (const pattern of emotionalPatterns) {
    if (pattern.test(lower)) {
      return {
        isPersonal: true,
        reason: 'emotional expression',
        confidence: 80
      };
    }
  }

  // Check non-claim patterns
  for (const pattern of nonClaimPatterns) {
    if (pattern.test(lower)) {
      return {
        isPersonal: true,
        reason: 'non-factual content',
        confidence: 90
      };
    }
  }

  // Check opinion patterns
  for (const pattern of opinionPatterns) {
    if (pattern.test(lower)) {
      return {
        isPersonal: true,
        reason: 'subjective opinion',
        confidence: 75
      };
    }
  }

  // Not detected as personal
  return {
    isPersonal: false,
    reason: 'appears to be a factual claim',
    confidence: 70
  };
}

// =============================================================================
// Truthfulness Spectrum Computation
// =============================================================================

/**
 * Verdict to base score mapping
 */
const VERDICT_SCORES = {
  'true': 1.0,
  'mostly_true': 0.8,
  'partially_true': 0.5,
  'mixed': 0.5,
  'unverifiable': 0.35,
  'mostly_false': 0.2,
  'false': 0.0
};

/**
 * Normalize a verdict string to a numerical score
 * @param {string} verdict - The verdict from an AI model
 * @returns {number} - Score between 0 and 1
 */
function normalizeVerdict(verdict) {
  if (!verdict) return 0.35; // Default to unverifiable
  
  const normalized = verdict.toLowerCase().replace(/[_-]/g, '_');
  
  // Exact match
  if (VERDICT_SCORES.hasOwnProperty(normalized)) {
    return VERDICT_SCORES[normalized];
  }
  
  // Partial match
  if (normalized.includes('true') && !normalized.includes('false')) {
    if (normalized.includes('partial') || normalized.includes('mixed')) {
      return 0.5;
    }
    if (normalized.includes('mostly')) {
      return 0.8;
    }
    return 1.0;
  }
  
  if (normalized.includes('false')) {
    if (normalized.includes('mostly')) {
      return 0.2;
    }
    return 0.0;
  }
  
  // Default for unknown verdicts
  return 0.35;
}

/**
 * Compute a weighted truthfulness score from multiple model responses
 * @param {Array} modelResponses - Array of model response objects
 * @returns {{ score: number, modelBreakdown: Array, consensus: string }}
 */
export function computeTruthfulnessSpectrum(modelResponses) {
  if (!modelResponses || modelResponses.length === 0) {
    return {
      score: null,
      modelBreakdown: [],
      consensus: 'unknown',
      explanation: 'no model responses available'
    };
  }

  let totalWeight = 0;
  let weightedSum = 0;
  const breakdown = [];

  for (const response of modelResponses) {
    const { model, verdict, confidence = 70 } = response;
    
    // Normalize verdict to score (0-1)
    const baseScore = normalizeVerdict(verdict);
    
    // Normalize confidence (0-100) to weight (0-1)
    const weight = Math.min(100, Math.max(0, confidence)) / 100;
    
    // Weighted contribution
    const contribution = baseScore * weight;
    
    weightedSum += contribution;
    totalWeight += weight;
    
    breakdown.push({
      model,
      verdict,
      confidence,
      baseScore: Math.round(baseScore * 100),
      weightedScore: Math.round(contribution * 100)
    });
  }

  // Calculate final percentage
  const finalScore = totalWeight > 0 
    ? Math.round((weightedSum / totalWeight) * 100) 
    : null;

  // Determine consensus label
  let consensus;
  if (finalScore === null) {
    consensus = 'unknown';
  } else if (finalScore >= 80) {
    consensus = 'true';
  } else if (finalScore >= 60) {
    consensus = 'mostly_true';
  } else if (finalScore >= 40) {
    consensus = 'mixed';
  } else if (finalScore >= 20) {
    consensus = 'mostly_false';
  } else {
    consensus = 'false';
  }

  // Generate explanation
  const explanation = generateExplanation(finalScore, breakdown, consensus);

  return {
    score: finalScore,
    modelBreakdown: breakdown,
    consensus,
    explanation
  };
}

/**
 * Generate a human-readable explanation of the score
 */
function generateExplanation(score, breakdown, consensus) {
  if (score === null) {
    return "couldn't get enough info to score this one";
  }

  const modelCount = breakdown.length;
  const agreeing = breakdown.filter(b => 
    (consensus === 'true' || consensus === 'mostly_true') ? b.baseScore >= 60 :
    (consensus === 'false' || consensus === 'mostly_false') ? b.baseScore <= 40 :
    true
  ).length;

  if (score >= 80) {
    return `${modelCount} AI models checked this and ${agreeing} agree it's legit (${score}% confidence)`;
  } else if (score >= 60) {
    return `looking mostly true but with some caveats (${score}% confidence from ${modelCount} models)`;
  } else if (score >= 40) {
    return `mixed signals here — some parts check out, others don't (${score}% confidence)`;
  } else if (score >= 20) {
    return `this is looking mostly false (${score}% confidence from ${modelCount} models)`;
  } else {
    return `yeah this doesn't check out at all (${score}% confidence it's false)`;
  }
}

// =============================================================================
// Combined Analysis Function
// =============================================================================

/**
 * Analyze text and return appropriate mode with score
 * @param {string} text - The input text
 * @param {Array} modelResponses - Model responses (only used if fact_check mode)
 * @returns {Object} - Analysis result with mode, score, and metadata
 */
export function analyzeWithSpectrum(text, modelResponses = []) {
  // First check if it's personal
  const personalCheck = detectPersonalStatement(text);
  
  if (personalCheck.isPersonal) {
    return {
      mode: 'personal',
      score: null,
      reason: personalCheck.reason,
      detectionConfidence: personalCheck.confidence,
      requiresFactCheck: false
    };
  }

  // It's a fact-checkable claim — compute spectrum
  const spectrum = computeTruthfulnessSpectrum(modelResponses);

  return {
    mode: 'fact_check',
    score: spectrum.score,
    consensus: spectrum.consensus,
    modelBreakdown: spectrum.modelBreakdown,
    explanation: spectrum.explanation,
    requiresFactCheck: true
  };
}

// =============================================================================
// Friendly Message Generators
// =============================================================================

/**
 * Generate a friendly message based on the spectrum score
 */
export function getSpectrumMessage(score, consensus) {
  if (score === null) {
    return "couldn't really figure this one out tbh";
  }

  if (score >= 85) {
    return "yep this checks out, pretty confident it's true";
  } else if (score >= 70) {
    return "looks legit for the most part";
  } else if (score >= 55) {
    return "it's... kinda true? there's nuance here";
  } else if (score >= 40) {
    return "getting mixed signals, hard to say either way";
  } else if (score >= 25) {
    return "this is looking pretty sus ngl";
  } else if (score >= 10) {
    return "yeah no this doesn't add up";
  } else {
    return "definitely false, don't believe this one";
  }
}

/**
 * Get verdict badge label from score
 */
export function getVerdictFromScore(score) {
  if (score === null) return 'UNKNOWN';
  if (score >= 70) return 'TRUE';
  if (score >= 40) return 'MIXED';
  return 'FALSE';
}

