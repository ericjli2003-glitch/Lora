/**
 * Semantic Cache
 * 
 * Two-tier caching system:
 * 1. Exact cache (SHA256 hash) - 10 min TTL
 * 2. Semantic cache (embedding similarity) - 24 hour TTL
 * 
 * Uses cosine similarity > 0.93 for semantic hits
 */

import crypto from 'crypto';
import OpenAI from 'openai';

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

// =============================================================================
// CACHE CONFIGURATION
// =============================================================================

const EXACT_CACHE_TTL = 10 * 60 * 1000;      // 10 minutes
const SEMANTIC_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const SIMILARITY_THRESHOLD = 0.93;
const MAX_SEMANTIC_ENTRIES = 1000;

// =============================================================================
// CACHE STORES
// =============================================================================

// Exact match cache (hash → result)
const exactCache = new Map();

// Semantic cache (array of { embedding, result, timestamp, text })
let semanticCache = [];

// Embedding cache (hash → embedding) to avoid re-computing
const embeddingCache = new Map();

// =============================================================================
// HASHING
// =============================================================================

function hashText(text) {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// =============================================================================
// EMBEDDINGS
// =============================================================================

/**
 * Get embedding for text (with caching)
 */
async function getEmbedding(text) {
  const hash = hashText(text);
  
  // Check embedding cache first
  const cached = embeddingCache.get(hash);
  if (cached) return cached;
  
  const openai = getClient();
  if (!openai) return null;
  
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text.substring(0, 8000), // Max input length
      dimensions: 256 // Smaller dimensions for speed
    });
    
    const embedding = response.data[0]?.embedding;
    
    if (embedding) {
      embeddingCache.set(hash, embedding);
      
      // Limit embedding cache size
      if (embeddingCache.size > 5000) {
        const firstKey = embeddingCache.keys().next().value;
        embeddingCache.delete(firstKey);
      }
    }
    
    return embedding;
  } catch (error) {
    console.error('Embedding error:', error.message);
    return null;
  }
}

/**
 * Compute cosine similarity between two embeddings
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (normA * normB);
}

// =============================================================================
// CACHE OPERATIONS
// =============================================================================

/**
 * Check exact cache (instant, <1ms)
 */
export function checkExactCache(text) {
  const hash = hashText(text);
  const entry = exactCache.get(hash);
  
  if (entry && Date.now() - entry.timestamp < EXACT_CACHE_TTL) {
    return { hit: true, type: 'exact', data: entry.data };
  }
  
  return { hit: false };
}

/**
 * Check semantic cache (requires embedding lookup)
 * Returns the best match if similarity > threshold
 */
export async function checkSemanticCache(text) {
  // First check exact cache
  const exact = checkExactCache(text);
  if (exact.hit) return exact;
  
  // Get embedding for input
  const embedding = await getEmbedding(text);
  if (!embedding) return { hit: false, reason: 'no_embedding' };
  
  // Clean expired entries
  const now = Date.now();
  semanticCache = semanticCache.filter(e => now - e.timestamp < SEMANTIC_CACHE_TTL);
  
  // Find best match
  let bestMatch = null;
  let bestSimilarity = 0;
  
  for (const entry of semanticCache) {
    const similarity = cosineSimilarity(embedding, entry.embedding);
    
    if (similarity > bestSimilarity && similarity >= SIMILARITY_THRESHOLD) {
      bestSimilarity = similarity;
      bestMatch = entry;
    }
  }
  
  if (bestMatch) {
    return {
      hit: true,
      type: 'semantic',
      similarity: bestSimilarity,
      data: bestMatch.data,
      originalText: bestMatch.text
    };
  }
  
  return { hit: false, embedding }; // Return embedding for later storage
}

/**
 * Store result in both caches
 */
export async function cacheResult(text, data, embedding = null) {
  const hash = hashText(text);
  const timestamp = Date.now();
  
  // Store in exact cache
  exactCache.set(hash, { data, timestamp });
  
  // Clean old exact cache entries
  if (exactCache.size > 5000) {
    for (const [key, entry] of exactCache.entries()) {
      if (Date.now() - entry.timestamp > EXACT_CACHE_TTL) {
        exactCache.delete(key);
      }
    }
  }
  
  // Store in semantic cache (get embedding if not provided)
  if (!embedding) {
    embedding = await getEmbedding(text);
  }
  
  if (embedding) {
    // Check if similar entry already exists
    const existingIndex = semanticCache.findIndex(e => {
      const sim = cosineSimilarity(embedding, e.embedding);
      return sim > 0.98; // Very similar = same entry
    });
    
    if (existingIndex >= 0) {
      // Update existing entry
      semanticCache[existingIndex] = { embedding, data, timestamp, text };
    } else {
      // Add new entry
      semanticCache.push({ embedding, data, timestamp, text });
      
      // Limit semantic cache size (remove oldest)
      if (semanticCache.length > MAX_SEMANTIC_ENTRIES) {
        semanticCache.sort((a, b) => b.timestamp - a.timestamp);
        semanticCache = semanticCache.slice(0, MAX_SEMANTIC_ENTRIES);
      }
    }
  }
}

// =============================================================================
// SPECULATIVE CACHE WRITE
// =============================================================================

/**
 * Pre-compute embedding while models are running
 * Call this immediately after receiving input
 */
export async function precomputeEmbedding(text) {
  return getEmbedding(text);
}

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================

export function getCacheStats() {
  return {
    exactCache: exactCache.size,
    semanticCache: semanticCache.length,
    embeddingCache: embeddingCache.size
  };
}

export function clearAllCaches() {
  exactCache.clear();
  semanticCache = [];
  embeddingCache.clear();
}

export function clearExpiredEntries() {
  const now = Date.now();
  
  // Clean exact cache
  for (const [key, entry] of exactCache.entries()) {
    if (now - entry.timestamp > EXACT_CACHE_TTL) {
      exactCache.delete(key);
    }
  }
  
  // Clean semantic cache
  semanticCache = semanticCache.filter(e => now - e.timestamp < SEMANTIC_CACHE_TTL);
}

// Auto-clean every 5 minutes
setInterval(clearExpiredEntries, 5 * 60 * 1000);

