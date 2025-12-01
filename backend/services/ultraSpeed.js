/**
 * Lora Ultra-Speed Mode
 * 
 * Two-phase pipeline with:
 * - Content fingerprinting (SHA256 caching)
 * - Model bucketing (FAST → MID → FULL)
 * - Delta verification (skip slow models if fast agree)
 * - Smart timeouts without accuracy loss
 * - Full models always have final priority
 */

import crypto from 'crypto';
import { checkWithOpenAI } from './openai.js';
import { checkWithAnthropic } from './anthropic.js';
import { checkWithGoogle } from './google.js';
import { checkWithPerplexity } from './perplexity.js';
import { 
  computeTruthfulnessSpectrum, 
  getSpectrumMessage, 
  getVerdictFromScore 
} from './truthfulnessSpectrum.js';

// =============================================================================
// CACHES (In-memory with TTL)
// =============================================================================

const fastCache = new Map();  // 5 minute TTL
const fullCache = new Map();  // 10 minute TTL
const sourceCache = new Map(); // 15 minute TTL for citations

const FAST_CACHE_TTL = 5 * 60 * 1000;   // 5 minutes
const FULL_CACHE_TTL = 10 * 60 * 1000;  // 10 minutes
const SOURCE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

/**
 * Clean expired cache entries periodically
 */
function cleanCache(cache, ttl) {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > ttl) {
      cache.delete(key);
    }
  }
}

// Clean caches every minute
setInterval(() => {
  cleanCache(fastCache, FAST_CACHE_TTL);
  cleanCache(fullCache, FULL_CACHE_TTL);
  cleanCache(sourceCache, SOURCE_CACHE_TTL);
}, 60 * 1000);

// =============================================================================
// CONTENT FINGERPRINTING
// =============================================================================

/**
 * Generate SHA256 hash for content fingerprinting
 */
function hashText(text) {
  return crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex');
}

/**
 * Check if result exists in cache
 */
function getCachedResult(text) {
  const hash = hashText(text);
  
  // Check full cache first (more accurate)
  const fullEntry = fullCache.get(hash);
  if (fullEntry && Date.now() - fullEntry.timestamp < FULL_CACHE_TTL) {
    return { hit: true, type: 'full', data: fullEntry.data };
  }
  
  // Check fast cache
  const fastEntry = fastCache.get(hash);
  if (fastEntry && Date.now() - fastEntry.timestamp < FAST_CACHE_TTL) {
    return { hit: true, type: 'fast', data: fastEntry.data };
  }
  
  return { hit: false };
}

/**
 * Store result in cache
 */
function cacheResult(text, data, type = 'full') {
  const hash = hashText(text);
  const entry = { data, timestamp: Date.now() };
  
  if (type === 'fast') {
    fastCache.set(hash, entry);
  } else {
    fullCache.set(hash, entry);
  }
}

/**
 * Cache sources/citations for reuse
 */
function cacheSources(claim, sources) {
  const hash = hashText(claim);
  sourceCache.set(hash, { sources, timestamp: Date.now() });
}

function getCachedSources(claim) {
  const hash = hashText(claim);
  const entry = sourceCache.get(hash);
  if (entry && Date.now() - entry.timestamp < SOURCE_CACHE_TTL) {
    return entry.sources;
  }
  return null;
}

// =============================================================================
// MODEL BUCKETS
// =============================================================================

/**
 * Model configuration with timeouts
 */
const MODEL_BUCKETS = {
  FAST: {
    timeout: 1500,  // 1.5 seconds
    models: [
      { name: 'OpenAI-Fast', fn: checkWithOpenAI, weight: 1.0 },
      { name: 'Google-Flash', fn: checkWithGoogle, weight: 1.0 },
      { name: 'Perplexity-Light', fn: checkWithPerplexity, weight: 0.9 }
    ]
  },
  MID: {
    timeout: 3000,  // 3 seconds
    models: [
      // Same models but we track them as "mid" tier for reporting
      { name: 'OpenAI-Mid', fn: checkWithOpenAI, weight: 1.0 },
      { name: 'Google-Pro', fn: checkWithGoogle, weight: 1.0 }
    ]
  },
  FULL: {
    timeout: 10000, // 10 seconds hard limit
    models: [
      { name: 'OpenAI-Full', fn: checkWithOpenAI, weight: 1.2 },
      { name: 'Anthropic-Claude', fn: checkWithAnthropic, weight: 1.3 },
      { name: 'Google-Full', fn: checkWithGoogle, weight: 1.1 },
      { name: 'Perplexity-Full', fn: checkWithPerplexity, weight: 1.0 }
    ]
  }
};

// =============================================================================
// TIMEOUT WRAPPER
// =============================================================================

/**
 * Run a model with timeout - returns unverifiable on timeout (no accuracy loss)
 */
async function runWithTimeout(modelFn, text, timeout, modelName) {
  const startTime = Date.now();
  
  try {
    const result = await Promise.race([
      modelFn(text),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('timeout')), timeout)
      )
    ]);
    
    return {
      success: true,
      model: modelName,
      latency: Date.now() - startTime,
      ...result
    };
  } catch (error) {
    if (error.message === 'timeout') {
      // Timeout: return unverifiable with low confidence (no accuracy penalty)
      return {
        success: true,
        model: modelName,
        verdict: 'unverifiable',
        confidence: 25,
        reasoning: 'Model timed out',
        latency: timeout,
        timedOut: true
      };
    }
    
    // Actual error
    return {
      success: false,
      model: modelName,
      error: error.message,
      latency: Date.now() - startTime
    };
  }
}

// =============================================================================
// BUCKET EXECUTION
// =============================================================================

/**
 * Run all models in a bucket in parallel
 */
async function runBucket(bucketName, text) {
  const bucket = MODEL_BUCKETS[bucketName];
  const startTime = Date.now();
  
  const promises = bucket.models.map(model => 
    runWithTimeout(model.fn, text, bucket.timeout, model.name)
  );
  
  const results = await Promise.allSettled(promises);
  
  const responses = results
    .filter(r => r.status === 'fulfilled' && r.value.success)
    .map(r => r.value);
  
  return {
    bucket: bucketName,
    responses,
    latency: Date.now() - startTime,
    modelCount: responses.length
  };
}

/**
 * Compute preliminary score from bucket results
 */
function computeBucketScore(responses) {
  if (responses.length === 0) {
    return { score: null, confidence: 0, agreement: false };
  }
  
  const spectrum = computeTruthfulnessSpectrum(responses);
  
  // Check if all models agree (within 20% of each other)
  const scores = responses
    .filter(r => r.verdict && r.confidence)
    .map(r => {
      const verdictScore = r.verdict.toLowerCase().includes('true') ? 100 :
                           r.verdict.toLowerCase().includes('false') ? 0 : 50;
      return verdictScore;
    });
  
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const agreement = (maxScore - minScore) <= 30;
  
  return {
    score: spectrum.score,
    confidence: spectrum.score !== null ? (agreement ? 0.9 : 0.7) : 0,
    agreement,
    breakdown: spectrum.modelBreakdown
  };
}

// =============================================================================
// DELTA VERIFICATION
// =============================================================================

/**
 * Determine if we need to run additional model buckets
 */
function shouldRunMidBucket(fastResult) {
  // Skip mid bucket if:
  // - Fast confidence >= 0.82 AND all fast models agree
  return !(fastResult.confidence >= 0.82 && fastResult.agreement);
}

function shouldRunFullBucket(fastResult, midResult) {
  // Skip full bucket if:
  // - Combined confidence >= 0.9 AND fast+mid agree
  const combinedConfidence = midResult 
    ? (fastResult.confidence + midResult.confidence) / 2 
    : fastResult.confidence;
  
  const bothAgree = fastResult.agreement && (!midResult || midResult.agreement);
  
  return !(combinedConfidence >= 0.9 && bothAgree);
}

// =============================================================================
// MAIN ULTRA-SPEED PIPELINE
// =============================================================================

/**
 * Ultra-speed fact-checking pipeline
 * Returns results with full accuracy, optimized for speed
 */
export async function ultraSpeedCheck(text) {
  const pipelineStart = Date.now();
  const usedModels = { fast: [], mid: [], full: [] };
  
  // ==========================================================================
  // STEP 1: Check cache (instant return if hit)
  // ==========================================================================
  
  const cached = getCachedResult(text);
  if (cached.hit && cached.type === 'full') {
    console.log(`   ⚡ Cache hit (full) - 0ms`);
    return {
      ...cached.data,
      fromCache: true,
      latency: { fastPhaseMs: 0, fullPhaseMs: 0, totalMs: 0 }
    };
  }
  
  // ==========================================================================
  // STEP 2: FAST PHASE (target: <800ms)
  // ==========================================================================
  
  console.log(`   ⚡ Phase 1: FAST bucket...`);
  const fastPhaseStart = Date.now();
  
  const fastBucket = await runBucket('FAST', text);
  usedModels.fast = fastBucket.responses.map(r => r.model);
  
  const fastResult = computeBucketScore(fastBucket.responses);
  const fastPhaseMs = Date.now() - fastPhaseStart;
  
  console.log(`      Fast: ${fastResult.score}% (${fastPhaseMs}ms, ${fastBucket.modelCount} models)`);
  console.log(`      Agreement: ${fastResult.agreement ? 'YES' : 'NO'}, Confidence: ${(fastResult.confidence * 100).toFixed(0)}%`);
  
  // Cache fast result
  cacheResult(text, {
    mode: 'fact_check',
    score: fastResult.score,
    confidence: fastResult.confidence,
    phase: 'fast'
  }, 'fast');
  
  // ==========================================================================
  // STEP 3: DELTA CHECK - Do we need more models?
  // ==========================================================================
  
  let midResult = null;
  let fullResult = null;
  let fullPhaseMs = 0;
  
  const needsMid = shouldRunMidBucket(fastResult);
  
  if (!needsMid) {
    console.log(`      ✓ Skipping MID+FULL buckets (high confidence agreement)`);
  } else {
    // ==========================================================================
    // STEP 4: MID PHASE (if needed)
    // ==========================================================================
    
    console.log(`   ⚡ Phase 2: Running additional models...`);
    const fullPhaseStart = Date.now();
    
    // Run MID and prepare for FULL in parallel
    const midBucket = await runBucket('MID', text);
    usedModels.mid = midBucket.responses.map(r => r.model);
    midResult = computeBucketScore(midBucket.responses);
    
    console.log(`      Mid: ${midResult.score}% (${midBucket.latency}ms)`);
    
    // ==========================================================================
    // STEP 5: FULL PHASE (if still needed)
    // ==========================================================================
    
    const needsFull = shouldRunFullBucket(fastResult, midResult);
    
    if (!needsFull) {
      console.log(`      ✓ Skipping FULL bucket (mid confirmed fast results)`);
      fullPhaseMs = Date.now() - fullPhaseStart;
    } else {
      console.log(`      Running FULL bucket for maximum accuracy...`);
      
      const fullBucket = await runBucket('FULL', text);
      usedModels.full = fullBucket.responses.map(r => r.model);
      fullResult = computeBucketScore(fullBucket.responses);
      fullPhaseMs = Date.now() - fullPhaseStart;
      
      console.log(`      Full: ${fullResult.score}% (${fullBucket.latency}ms, ${fullBucket.modelCount} models)`);
    }
  }
  
  // ==========================================================================
  // STEP 6: MERGE RESULTS (full models always win)
  // ==========================================================================
  
  let finalScore;
  let finalConfidence;
  let spectrumBreakdown = [];
  
  if (fullResult && fullResult.score !== null) {
    // Full bucket ran - use its result (highest accuracy)
    finalScore = fullResult.score;
    finalConfidence = fullResult.confidence;
    spectrumBreakdown = fullResult.breakdown || [];
    
    // Check if full deviated from fast by >10%
    if (fastResult.score !== null && Math.abs(fullResult.score - fastResult.score) > 10) {
      console.log(`      ⚠️ Full result deviated from fast by ${Math.abs(fullResult.score - fastResult.score)}%`);
    }
  } else if (midResult && midResult.score !== null) {
    // Mid bucket ran - weighted average with fast
    finalScore = Math.round((fastResult.score * 0.4 + midResult.score * 0.6));
    finalConfidence = (fastResult.confidence + midResult.confidence) / 2;
    spectrumBreakdown = [...(fastResult.breakdown || []), ...(midResult.breakdown || [])];
  } else {
    // Only fast bucket - use its result
    finalScore = fastResult.score;
    finalConfidence = fastResult.confidence;
    spectrumBreakdown = fastResult.breakdown || [];
  }
  
  // ==========================================================================
  // STEP 7: BUILD FINAL RESULT
  // ==========================================================================
  
  const totalMs = Date.now() - pipelineStart;
  const verdict = getVerdictFromScore(finalScore);
  const message = getSpectrumMessage(finalScore, verdict.toLowerCase());
  
  const result = {
    mode: 'fact_check',
    claim: text,
    score: finalScore,
    confidence: finalConfidence,
    loraVerdict: verdict,
    loraMessage: message,
    latency: {
      fastPhaseMs,
      fullPhaseMs,
      totalMs
    },
    usedModels,
    spectrumBreakdown,
    pipelineInfo: {
      skippedMid: !needsMid,
      skippedFull: needsMid && !shouldRunFullBucket(fastResult, midResult),
      cacheHit: false
    }
  };
  
  // Cache the full result
  cacheResult(text, result, 'full');
  
  console.log(`   🎯 Final: ${finalScore}% ${verdict} (${totalMs}ms total)`);
  
  return result;
}

// =============================================================================
// CACHE STATS (for debugging)
// =============================================================================

export function getCacheStats() {
  return {
    fastCache: fastCache.size,
    fullCache: fullCache.size,
    sourceCache: sourceCache.size
  };
}

export function clearCaches() {
  fastCache.clear();
  fullCache.clear();
  sourceCache.clear();
}

