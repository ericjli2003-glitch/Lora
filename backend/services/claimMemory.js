/**
 * Lora Max Performance - Agentic Memory
 * 
 * Maintains a short-term memory index of previously checked public claims.
 * Memory is ONLY for public factual assertions, NOT personal claims.
 * 
 * Features:
 * - Fast O(1) lookup via hash
 * - Normalized text matching
 * - TTL-based expiration
 * - Memory statistics
 */

import crypto from 'crypto';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Maximum number of entries in memory
  MAX_ENTRIES: 10000,
  
  // Time-to-live in milliseconds (24 hours)
  TTL_MS: 24 * 60 * 60 * 1000,
  
  // Minimum confidence to store in memory
  MIN_CONFIDENCE_TO_STORE: 50,
  
  // Enable fuzzy matching (slight text variations)
  FUZZY_MATCH: true,
  
  // Fuzzy match threshold (0-1, higher = stricter)
  FUZZY_THRESHOLD: 0.85
};

// =============================================================================
// MEMORY STORE
// =============================================================================

// Primary memory store: hash -> { claim, credibility, explanation, timestamp, hits }
const memory = new Map();

// Reverse index for fuzzy matching: normalized_prefix -> [hashes]
const prefixIndex = new Map();

// Statistics
const stats = {
  totalLookups: 0,
  hits: 0,
  misses: 0,
  stores: 0,
  evictions: 0,
  fuzzyHits: 0
};

// =============================================================================
// HASHING & NORMALIZATION
// =============================================================================

/**
 * Create a hash key from normalized text
 */
function hashClaim(normalizedText) {
  return crypto
    .createHash('sha256')
    .update(normalizedText)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Normalize text for memory matching
 * More aggressive than regular normalization
 */
function normalizeForMemory(text) {
  if (!text) return '';
  
  return text
    .toLowerCase()
    .trim()
    // Remove all punctuation
    .replace(/[^\w\s]/g, '')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    // Remove common filler words
    .replace(/\b(the|a|an|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|could|should|may|might|must|shall|can|need|dare|ought|used|to|of|in|for|on|with|at|by|from|as|into|through|during|before|after|above|below|between|under|again|further|then|once|here|there|when|where|why|how|all|each|every|both|few|more|most|other|some|such|no|nor|not|only|own|same|so|than|too|very|just|also)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get prefix for fuzzy index (first N characters)
 */
function getPrefix(normalizedText, length = 20) {
  return normalizedText.substring(0, length);
}

// =============================================================================
// MEMORY OPERATIONS
// =============================================================================

/**
 * Look up a claim in memory
 * @param {string} text - Original or normalized claim text
 * @returns {{ hit: boolean, data?: Object, source: 'exact' | 'fuzzy' | 'miss' }}
 */
export function lookupClaim(text) {
  stats.totalLookups++;
  
  const normalized = normalizeForMemory(text);
  if (!normalized || normalized.length < 10) {
    stats.misses++;
    return { hit: false, source: 'miss' };
  }
  
  const hash = hashClaim(normalized);
  
  // Exact match
  if (memory.has(hash)) {
    const entry = memory.get(hash);
    
    // Check TTL
    if (Date.now() - entry.timestamp > CONFIG.TTL_MS) {
      memory.delete(hash);
      stats.misses++;
      return { hit: false, source: 'miss' };
    }
    
    // Update hit count
    entry.hits++;
    stats.hits++;
    
    return {
      hit: true,
      source: 'exact',
      data: {
        claim: entry.claim,
        credibility: entry.credibility,
        explanation: entry.explanation,
        fromMemory: true,
        memoryHits: entry.hits,
        storedAt: new Date(entry.timestamp).toISOString()
      }
    };
  }
  
  // Fuzzy match (if enabled)
  if (CONFIG.FUZZY_MATCH) {
    const prefix = getPrefix(normalized);
    const candidates = prefixIndex.get(prefix) || [];
    
    for (const candidateHash of candidates) {
      if (memory.has(candidateHash)) {
        const entry = memory.get(candidateHash);
        
        // Check TTL
        if (Date.now() - entry.timestamp > CONFIG.TTL_MS) {
          continue;
        }
        
        // Simple similarity check (Jaccard-like)
        const similarity = calculateSimilarity(normalized, entry.normalizedClaim);
        
        if (similarity >= CONFIG.FUZZY_THRESHOLD) {
          entry.hits++;
          stats.hits++;
          stats.fuzzyHits++;
          
          return {
            hit: true,
            source: 'fuzzy',
            similarity,
            data: {
              claim: entry.claim,
              credibility: entry.credibility,
              explanation: entry.explanation,
              fromMemory: true,
              memoryHits: entry.hits,
              storedAt: new Date(entry.timestamp).toISOString()
            }
          };
        }
      }
    }
  }
  
  stats.misses++;
  return { hit: false, source: 'miss' };
}

/**
 * Store a fact-checked claim in memory
 * @param {string} claim - Original claim text
 * @param {number} credibility - Credibility score (0-100)
 * @param {string} explanation - Short explanation
 * @returns {boolean} Whether the claim was stored
 */
export function storeClaim(claim, credibility, explanation) {
  if (credibility < CONFIG.MIN_CONFIDENCE_TO_STORE) {
    return false; // Don't store uncertain results
  }
  
  const normalized = normalizeForMemory(claim);
  if (!normalized || normalized.length < 10) {
    return false;
  }
  
  // Check memory size and evict if necessary
  if (memory.size >= CONFIG.MAX_ENTRIES) {
    evictOldest();
  }
  
  const hash = hashClaim(normalized);
  
  const entry = {
    claim,
    normalizedClaim: normalized,
    credibility,
    explanation,
    timestamp: Date.now(),
    hits: 0
  };
  
  memory.set(hash, entry);
  
  // Update prefix index for fuzzy matching
  if (CONFIG.FUZZY_MATCH) {
    const prefix = getPrefix(normalized);
    if (!prefixIndex.has(prefix)) {
      prefixIndex.set(prefix, []);
    }
    prefixIndex.get(prefix).push(hash);
  }
  
  stats.stores++;
  return true;
}

/**
 * Batch lookup multiple claims
 * Returns { fromMemory: [...], needsCheck: [...] }
 */
export function batchLookup(claims) {
  const fromMemory = [];
  const needsCheck = [];
  
  for (const claim of claims) {
    const result = lookupClaim(claim.normalized || claim.segment || claim);
    
    if (result.hit) {
      fromMemory.push({
        ...claim,
        ...result.data,
        source: result.source
      });
    } else {
      needsCheck.push(claim);
    }
  }
  
  return { fromMemory, needsCheck };
}

/**
 * Batch store multiple results
 */
export function batchStore(results) {
  let stored = 0;
  for (const result of results) {
    if (storeClaim(result.segment || result.claim, result.credibility, result.explanation)) {
      stored++;
    }
  }
  return stored;
}

// =============================================================================
// MEMORY MANAGEMENT
// =============================================================================

/**
 * Evict oldest entries when memory is full
 */
function evictOldest() {
  let oldest = null;
  let oldestTime = Infinity;
  
  for (const [hash, entry] of memory) {
    // Prioritize evicting low-hit entries
    const age = Date.now() - entry.timestamp;
    const priority = age / Math.max(1, entry.hits);
    
    if (entry.timestamp < oldestTime || priority > oldestTime) {
      oldest = hash;
      oldestTime = entry.timestamp;
    }
  }
  
  if (oldest) {
    memory.delete(oldest);
    stats.evictions++;
  }
}

/**
 * Clear all memory
 */
export function clearMemory() {
  memory.clear();
  prefixIndex.clear();
  stats.totalLookups = 0;
  stats.hits = 0;
  stats.misses = 0;
  stats.stores = 0;
  stats.evictions = 0;
  stats.fuzzyHits = 0;
}

/**
 * Get memory statistics
 */
export function getMemoryStats() {
  return {
    size: memory.size,
    maxSize: CONFIG.MAX_ENTRIES,
    hitRate: stats.totalLookups > 0 ? 
      ((stats.hits / stats.totalLookups) * 100).toFixed(1) + '%' : 
      '0%',
    ...stats
  };
}

/**
 * Clean expired entries
 */
export function cleanExpired() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [hash, entry] of memory) {
    if (now - entry.timestamp > CONFIG.TTL_MS) {
      memory.delete(hash);
      cleaned++;
    }
  }
  
  return cleaned;
}

// =============================================================================
// SIMILARITY CALCULATION
// =============================================================================

/**
 * Calculate word-based similarity between two normalized strings
 */
function calculateSimilarity(text1, text2) {
  const words1 = new Set(text1.split(' '));
  const words2 = new Set(text2.split(' '));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// =============================================================================
// AUTO-CLEANUP
// =============================================================================

// Run cleanup every hour
setInterval(() => {
  const cleaned = cleanExpired();
  if (cleaned > 0) {
    console.log(`[ClaimMemory] Cleaned ${cleaned} expired entries`);
  }
}, 60 * 60 * 1000);

export default {
  lookupClaim,
  storeClaim,
  batchLookup,
  batchStore,
  clearMemory,
  getMemoryStats,
  cleanExpired
};

