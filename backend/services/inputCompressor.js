/**
 * Input Compressor
 * 
 * Reduces input text to essential claims before heavy inference.
 * - Removes filler, emoji, repeated lines
 * - Extracts core factual claim
 * - Preserves semantic meaning
 */

import OpenAI from 'openai';

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// =============================================================================
// FAST LOCAL COMPRESSION (no API call)
// =============================================================================

/**
 * Quick local text cleaning (runs in <1ms)
 * Use this for all inputs before any processing
 */
export function quickClean(text) {
  if (!text || typeof text !== 'string') return '';
  
  return text
    // Remove emoji FIRST (before whitespace collapse)
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu, '')
    // Remove excessive whitespace (after emoji removal)
    .replace(/\s+/g, ' ')
    // Remove repeated punctuation
    .replace(/([!?.])\1+/g, '$1')
    // Remove common filler phrases
    .replace(/\b(um|uh|like|basically|literally|actually|you know|i mean)\b/gi, '')
    // Remove URLs (keep domain for context)
    .replace(/https?:\/\/[^\s]+/g, '[link]')
    // Remove repeated words
    .replace(/\b(\w+)\s+\1\b/gi, '$1')
    // Collapse any remaining double spaces
    .replace(/\s+/g, ' ')
    // Trim
    .trim();
}

/**
 * Remove duplicate sentences/lines
 */
export function deduplicateLines(text) {
  const lines = text.split(/[.\n]+/).map(l => l.trim()).filter(Boolean);
  const seen = new Set();
  const unique = [];
  
  for (const line of lines) {
    const normalized = line.toLowerCase().replace(/[^\w\s]/g, '');
    if (!seen.has(normalized) && normalized.length > 3) {
      seen.add(normalized);
      unique.push(line);
    }
  }
  
  return unique.join('. ');
}

/**
 * Extract what looks like the main claim from text
 * Uses heuristics (no API call)
 */
export function extractMainClaim(text) {
  const cleaned = quickClean(text);
  const sentences = cleaned.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  
  if (sentences.length === 0) return cleaned;
  if (sentences.length === 1) return sentences[0];
  
  // Heuristics for finding the main claim
  const claimIndicators = [
    /^(the |a |an |this |that |it |they |he |she |we )/i,
    /\b(is|are|was|were|will|has|have|had|does|do|did)\b/i,
    /\b(claim|fact|true|false|actually|really|proven|study|research|found|shows|according)\b/i,
    /\b(percent|million|billion|thousand|number|data|statistic)\b/i,
  ];
  
  // Score each sentence
  let bestSentence = sentences[0];
  let bestScore = 0;
  
  for (const sentence of sentences) {
    let score = 0;
    
    // Longer sentences often contain more substance
    score += Math.min(sentence.length / 50, 2);
    
    // Check for claim indicators
    for (const pattern of claimIndicators) {
      if (pattern.test(sentence)) score += 1;
    }
    
    // Penalize questions
    if (sentence.includes('?')) score -= 2;
    
    // Penalize personal pronouns at start
    if (/^(i |my |me )/i.test(sentence)) score -= 1;
    
    if (score > bestScore) {
      bestScore = score;
      bestSentence = sentence;
    }
  }
  
  return bestSentence;
}

// =============================================================================
// FULL COMPRESSION (with AI, for slow models)
// =============================================================================

const COMPRESSION_PROMPT = `Extract ONLY the core factual claim from this text. 
Remove all filler, opinions, emotions, and context that isn't needed for fact-checking.
Return ONLY the claim as a single, clear sentence. Nothing else.

Text: """
{TEXT}
"""

Core claim:`;

/**
 * AI-powered compression for complex/long inputs
 * Only use this for slow model calls where compression saves more time than it costs
 */
export async function compressForInference(text, options = {}) {
  const { maxLength = 500, useAI = true } = options;
  
  // Step 1: Quick local cleaning
  let compressed = quickClean(text);
  compressed = deduplicateLines(compressed);
  
  // If already short enough, return
  if (compressed.length <= maxLength) {
    return {
      original: text,
      compressed,
      method: 'local',
      ratio: text.length / compressed.length
    };
  }
  
  // Step 2: Extract main claim locally
  compressed = extractMainClaim(compressed);
  
  if (compressed.length <= maxLength) {
    return {
      original: text,
      compressed,
      method: 'heuristic',
      ratio: text.length / compressed.length
    };
  }
  
  // Step 3: Use AI compression for very long texts
  if (useAI && compressed.length > maxLength) {
    const openai = getClient();
    
    if (openai) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini', // Fast model for compression
          messages: [{
            role: 'user',
            content: COMPRESSION_PROMPT.replace('{TEXT}', compressed.substring(0, 2000))
          }],
          max_tokens: 150,
          temperature: 0.1
        });
        
        const aiCompressed = response.choices[0]?.message?.content?.trim();
        
        if (aiCompressed && aiCompressed.length > 10 && aiCompressed.length < compressed.length) {
          return {
            original: text,
            compressed: aiCompressed,
            method: 'ai',
            ratio: text.length / aiCompressed.length
          };
        }
      } catch (error) {
        // Fall back to local compression on error
      }
    }
  }
  
  // Fallback: truncate intelligently
  if (compressed.length > maxLength) {
    compressed = compressed.substring(0, maxLength - 3) + '...';
  }
  
  return {
    original: text,
    compressed,
    method: 'truncate',
    ratio: text.length / compressed.length
  };
}

// =============================================================================
// BATCH COMPRESSION
// =============================================================================

/**
 * Compress multiple texts in parallel
 */
export async function compressBatch(texts, options = {}) {
  const results = await Promise.all(
    texts.map(text => compressForInference(text, options))
  );
  return results;
}

