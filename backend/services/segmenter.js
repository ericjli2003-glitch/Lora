/**
 * Lora Max Performance - Input Segmenter
 * 
 * Splits ANY input into minimal atomic truth-segments.
 * Handles TikTok mode for chaotic, slang-filled content.
 */

// =============================================================================
// TIKTOK MODE DETECTION
// =============================================================================

const TIKTOK_INDICATORS = {
  // Emoji density threshold
  emojiRatio: 0.05,
  // Slang words
  slang: /\b(fr|ngl|ong|lowkey|highkey|bussin|cap|nocap|no cap|slay|fire|lit|vibes|sus|bet|fam|bruh|sis|periodt|snatched|tea|stan|simp|vibe check|main character|rent free|understood the assignment)\b/gi,
  // Chaotic punctuation
  chaoticPunctuation: /[!?]{2,}|\.{3,}|~+/g,
  // Run-on sentences (very long without proper punctuation)
  runOnThreshold: 150,
  // Hype phrases
  hype: /\b(you won't believe|wait for it|plot twist|breaking|exposed|leaked|confirmed|proof that|this is why|watch till the end)\b/gi
};

/**
 * Detect if input is TikTok-style chaotic content
 */
export function detectTikTokMode(text) {
  if (!text || typeof text !== 'string') return false;
  
  let score = 0;
  
  // Check emoji density
  const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]/gu) || []).length;
  if (emojiCount / text.length > TIKTOK_INDICATORS.emojiRatio) score += 2;
  
  // Check slang
  const slangMatches = text.match(TIKTOK_INDICATORS.slang) || [];
  if (slangMatches.length >= 2) score += 2;
  
  // Check chaotic punctuation
  if (TIKTOK_INDICATORS.chaoticPunctuation.test(text)) score += 1;
  
  // Check for run-on sentences
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const hasRunOn = sentences.some(s => s.length > TIKTOK_INDICATORS.runOnThreshold);
  if (hasRunOn) score += 1;
  
  // Check hype phrases
  if (TIKTOK_INDICATORS.hype.test(text)) score += 2;
  
  return {
    isTikTok: score >= 3,
    score,
    indicators: {
      emojiCount,
      slangMatches: slangMatches.length,
      hasChaoticPunctuation: TIKTOK_INDICATORS.chaoticPunctuation.test(text),
      hasRunOn,
      hasHype: TIKTOK_INDICATORS.hype.test(text)
    }
  };
}

// =============================================================================
// TEXT NORMALIZATION
// =============================================================================

// Common typo corrections for fact-checking
const TYPO_MAP = {
  'piza': 'pizza',
  'grren': 'green',
  'teh': 'the',
  'adn': 'and',
  'becuase': 'because',
  'goverment': 'government',
  'definately': 'definitely',
  'occured': 'occurred',
  'recieve': 'receive',
  'seperate': 'separate',
  'thier': 'their',
  'untill': 'until',
  'wierd': 'weird',
  'vaccum': 'vacuum',
  'neccessary': 'necessary',
  'accomodate': 'accommodate',
  'millenial': 'millennial',
  'occassion': 'occasion',
  'restaraunt': 'restaurant'
};

/**
 * Normalize text for fact-checking (preserves original for display)
 */
export function normalizeForFactCheck(text) {
  if (!text) return '';
  
  let normalized = text.toLowerCase().trim();
  
  // Fix common typos
  for (const [typo, correct] of Object.entries(TYPO_MAP)) {
    normalized = normalized.replace(new RegExp(`\\b${typo}\\b`, 'gi'), correct);
  }
  
  // Remove excessive whitespace
  normalized = normalized.replace(/\s+/g, ' ');
  
  // Remove emoji for matching purposes
  normalized = normalized.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]/gu, '');
  
  return normalized.trim();
}

// =============================================================================
// SEGMENTATION LOGIC
// =============================================================================

/**
 * Standard segmentation by sentence/clause boundaries
 * Optimized to isolate personal from factual claims
 */
function standardSegment(text) {
  const segments = [];
  
  // Pre-process: split by "Also did you know" and similar fact-introducers
  const preprocessed = text
    .replace(/\.\s*(also |and |but |oh and |plus )?did you know\s*/gi, '. [SPLIT] ')
    .replace(/\.\s*(also |and |but )?fun fact:?\s*/gi, '. [SPLIT] ')
    .replace(/\.\s*btw\s*/gi, '. [SPLIT] ');
  
  // Split by sentence boundaries AND our markers
  const sentences = preprocessed.split(/(?<=[.!?])\s+|\[SPLIT\]/);
  
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed || trimmed.length < 5) continue;
    
    // Check if sentence mixes personal and factual content
    const hasPersonal = /^(my|i |i'|we |our )/i.test(trimmed);
    const hasFactual = /(is|are|was|were|causes?|cures?|confirmed|proven|invented|discovered|failed|located|capital|made of|is in|tower|einstein|vaccine)/i.test(trimmed);
    
    // If it mixes both, try to split more aggressively
    if (hasPersonal && hasFactual && trimmed.length > 40) {
      // Split by "Also", "And", "But", etc.
      const parts = trimmed.split(/\s+(?:also|and also|plus|but also|oh and|but)\s+/i);
      for (const part of parts) {
        if (part.trim().length > 8) {
          segments.push(part.trim());
        }
      }
    } else if (trimmed.length > 100) {
      // Further split long sentences by major conjunctions
      const clauses = trimmed.split(/\s*(?:,\s*(?:and|but|or|however|although|because|since|while|whereas))\s*/i);
      for (const clause of clauses) {
        if (clause.trim().length > 10) {
          segments.push(clause.trim());
        }
      }
    } else {
      segments.push(trimmed);
    }
  }
  
  return segments;
}

/**
 * Aggressive TikTok-style segmentation
 * Key principle: ALWAYS split to isolate factual claims from personal statements
 */
function tikTokSegment(text) {
  const segments = [];
  
  // First, split by obvious boundaries
  let chunks = text
    // Split by emoji clusters (but don't lose text)
    .replace(/([\u{1F300}-\u{1F9FF}]+)/gu, ' |SPLIT| ')
    .split('|SPLIT|')
    // Split by line breaks
    .flatMap(chunk => chunk.split(/\n+/))
    // Split by sentence endings
    .flatMap(chunk => chunk.split(/(?<=[.!?])\s*/))
    // Split by hype markers
    .flatMap(chunk => chunk.split(/(?:wait for it|plot twist|breaking|but like|and then|so basically|okay so|also|and also|plus|oh and)/i))
    // Split by "and" when it separates distinct claims
    .flatMap(chunk => {
      // If chunk contains "and" + factual indicator, split it
      if (/\band\b.{5,}(is|are|was|were|causes?|cures?|confirmed|proven)/i.test(chunk)) {
        return chunk.split(/\s+and\s+/i);
      }
      return [chunk];
    });
  
  for (let chunk of chunks) {
    chunk = chunk.trim();
    if (!chunk || chunk.length < 5) continue;
    
    // Skip pure emoji chunks
    if (/^[\u{1F300}-\u{1F9FF}\s]+$/u.test(chunk)) continue;
    
    // Skip pure slang/filler
    if (/^(fr|fr fr|no cap|ngl|ong|lowkey|highkey|like|literally|basically)$/i.test(chunk)) continue;
    
    // Further split long chunks by commas and conjunctions
    if (chunk.length > 60) {
      const subChunks = chunk.split(/\s*[,;]\s*|\s+(?:but|or|also|plus)\s+/i);
      for (const sub of subChunks) {
        const cleaned = sub.trim();
        if (cleaned.length > 8) {
          segments.push(cleaned);
        }
      }
    } else if (chunk.length > 8) {
      segments.push(chunk);
    }
  }
  
  return segments;
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Segment input into atomic truth-claims
 * @param {string} text - Raw input text
 * @param {Object} options - Segmentation options
 * @returns {{ segments: string[], tikTokMode: boolean, metadata: Object }}
 */
export function segmentInput(text, options = {}) {
  if (!text || typeof text !== 'string') {
    return { segments: [], tikTokMode: false, metadata: {} };
  }
  
  const startTime = performance.now();
  
  // Detect TikTok mode
  const tikTokDetection = options.forceTikTok ? 
    { isTikTok: true, score: 10, indicators: {} } : 
    detectTikTokMode(text);
  
  // Choose segmentation strategy
  const rawSegments = tikTokDetection.isTikTok ? 
    tikTokSegment(text) : 
    standardSegment(text);
  
  // Deduplicate and clean
  const seen = new Set();
  const segments = [];
  
  for (const seg of rawSegments) {
    const normalized = normalizeForFactCheck(seg);
    if (normalized.length > 5 && !seen.has(normalized)) {
      seen.add(normalized);
      segments.push({
        original: seg,
        normalized,
        length: seg.length
      });
    }
  }
  
  const elapsed = performance.now() - startTime;
  
  return {
    segments,
    tikTokMode: tikTokDetection.isTikTok,
    metadata: {
      inputLength: text.length,
      segmentCount: segments.length,
      tikTokScore: tikTokDetection.score,
      indicators: tikTokDetection.indicators,
      segmentationTimeMs: elapsed.toFixed(2)
    }
  };
}

export default {
  segmentInput,
  detectTikTokMode,
  normalizeForFactCheck
};

