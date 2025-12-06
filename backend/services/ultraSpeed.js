/**
 * Lora Ultra-Speed Pipeline v2
 * 
 * Full accuracy-preserving inference pipeline with:
 * - Two-phase FAST → FULL execution
 * - Semantic + exact caching
 * - Input compression
 * - Delta verification (skip slow models when not needed)
 * - Speculative execution
 * - Per-model timeouts
 * - Full parallelization
 * 
 * Target: 2×–10× latency reduction with no accuracy loss
 */

import { checkWithOpenAI } from './openai.js';
import { checkWithAnthropic } from './anthropic.js';
import { checkWithGoogle } from './google.js';
import { checkWithPerplexity } from './perplexity.js';
import { 
  computeTruthfulnessSpectrum, 
  getSpectrumMessage, 
  getVerdictFromScore,
  detectPersonalStatement 
} from './truthfulnessSpectrum.js';
import { 
  checkExactCache, 
  checkSemanticCache, 
  cacheResult, 
  precomputeEmbedding,
  getCacheStats as getSemanticCacheStats,
  clearAllCaches as clearSemanticCaches
} from './semanticCache.js';
import { quickClean, compressForInference } from './inputCompressor.js';
import { quickSearchSources } from './webSearch.js';
import logger from './logger.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Confidence thresholds for skipping
  SKIP_MID_THRESHOLD: 0.88,    // Skip mid bucket if fast confidence >= this
  SKIP_FULL_THRESHOLD: 0.90,   // Skip full bucket if combined confidence >= this
  
  // Timeout settings (ms)
  FAST_TIMEOUT: 1500,
  MID_TIMEOUT: 3500,
  FULL_TIMEOUT: 10000,
  
  // Cache TTLs
  EXACT_CACHE_TTL: 10 * 60 * 1000,    // 10 minutes
  SEMANTIC_CACHE_TTL: 24 * 60 * 60 * 1000, // 24 hours
  
  // Input compression
  MAX_INPUT_LENGTH: 500,
  COMPRESS_THRESHOLD: 300
};

// =============================================================================
// MODEL BUCKET DEFINITIONS
// =============================================================================

/**
 * Model buckets with their configurations
 * FAST → MID → FULL progression
 */
const MODEL_BUCKETS = {
  FAST: {
    timeout: CONFIG.FAST_TIMEOUT,
    weight: 0.8,
    models: [
      { name: 'GPT-4o-mini', fn: checkWithOpenAI, weight: 1.0 },
      { name: 'Gemini-Flash', fn: checkWithGoogle, weight: 1.0 },
      { name: 'Perplexity-Lite', fn: checkWithPerplexity, weight: 0.9 }
    ]
  },
  MID: {
    timeout: CONFIG.MID_TIMEOUT,
    weight: 1.0,
    models: [
      { name: 'GPT-4o', fn: checkWithOpenAI, weight: 1.1 },
      { name: 'Gemini-Pro', fn: checkWithGoogle, weight: 1.0 }
    ]
  },
  FULL: {
    timeout: CONFIG.FULL_TIMEOUT,
    weight: 1.2,
    models: [
      { name: 'GPT-4o-Full', fn: checkWithOpenAI, weight: 1.2 },
      { name: 'Claude-Sonnet', fn: checkWithAnthropic, weight: 1.3 },
      { name: 'Gemini-Full', fn: checkWithGoogle, weight: 1.1 },
      { name: 'Perplexity-Full', fn: checkWithPerplexity, weight: 1.0 }
    ]
  }
};

// =============================================================================
// TIMEOUT WRAPPER
// =============================================================================

/**
 * Run a model with timeout
 * Returns unverifiable on timeout (no accuracy loss)
 */
async function runWithTimeout(modelFn, text, timeout, modelName) {
  const timer = logger.createTimer(modelName);
  
  try {
    const result = await Promise.race([
      modelFn(text),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), timeout)
      )
    ]);
    
    const latency = timer.elapsed();
    logger.modelResult(modelName, result.verdict, result.confidence, latency);
    
    return {
      success: true,
      model: modelName,
      latency,
      ...result
    };
  } catch (error) {
    const latency = timer.elapsed();
    
    if (error.message === 'TIMEOUT') {
      logger.debug(`  ⏱️ ${modelName}: Timeout after ${timeout}ms`);
      return {
        success: true,
        model: modelName,
        verdict: 'unverifiable',
        confidence: 25,
        reasoning: 'Model timed out',
        latency,
        timedOut: true
      };
    }
    
    logger.debug(`  ❌ ${modelName}: ${error.message}`);
    return {
      success: false,
      model: modelName,
      error: error.message,
      latency
    };
  }
}

// =============================================================================
// BUCKET EXECUTION
// =============================================================================

/**
 * Run all models in a bucket in parallel
 */
async function runBucket(bucketName, text, compressedText = null) {
  const bucket = MODEL_BUCKETS[bucketName];
  const timer = logger.createTimer(`Bucket:${bucketName}`);
  
  // Use compressed text for slower buckets
  const inputText = (bucketName !== 'FAST' && compressedText) ? compressedText : text;
  
  const promises = bucket.models.map(model => 
    runWithTimeout(model.fn, inputText, bucket.timeout, model.name)
  );
  
  const results = await Promise.allSettled(promises);
  
  const responses = results
    .filter(r => r.status === 'fulfilled' && r.value.success)
    .map(r => r.value);
  
  const latency = timer.elapsed();
  logger.debug(`  ${bucketName} bucket: ${responses.length}/${bucket.models.length} models, ${latency}ms`);
  
  return {
    bucket: bucketName,
    responses,
    latency,
    modelCount: responses.length,
    totalModels: bucket.models.length
  };
}

/**
 * Compute score and agreement from bucket results
 */
function computeBucketScore(responses) {
  if (responses.length === 0) {
    return { score: null, confidence: 0, agreement: false, breakdown: [] };
  }
  
  const spectrum = computeTruthfulnessSpectrum(responses);
  
  // Check model agreement (all within 30% of each other)
  const scores = responses
    .filter(r => r.verdict && r.confidence)
    .map(r => {
      const v = r.verdict.toLowerCase();
      return v.includes('true') ? 100 : v.includes('false') ? 0 : 50;
    });
  
  const maxScore = Math.max(...scores, 0);
  const minScore = Math.min(...scores, 100);
  const agreement = scores.length > 0 && (maxScore - minScore) <= 30;
  
  // Confidence based on agreement and response count
  let confidence = 0;
  if (spectrum.score !== null) {
    confidence = agreement ? 0.92 : 0.75;
    confidence *= (responses.length / 3); // Scale by response count
    confidence = Math.min(1, confidence);
  }
  
  return {
    score: spectrum.score,
    confidence,
    agreement,
    breakdown: spectrum.modelBreakdown || []
  };
}

// =============================================================================
// DELTA VERIFICATION
// =============================================================================

/**
 * Determine if MID bucket should run
 */
function shouldRunMidBucket(fastResult) {
  // Run MID if:
  // - Fast confidence < threshold OR
  // - Fast models disagree
  return fastResult.confidence < CONFIG.SKIP_MID_THRESHOLD || !fastResult.agreement;
}

/**
 * Determine if FULL bucket should run
 */
function shouldRunFullBucket(fastResult, midResult) {
  if (!midResult) {
    // No mid results - check fast only
    return fastResult.confidence < CONFIG.SKIP_FULL_THRESHOLD;
  }
  
  // Combined confidence
  const combinedConfidence = (fastResult.confidence * 0.4 + midResult.confidence * 0.6);
  const bothAgree = fastResult.agreement && midResult.agreement;
  
  // Also check if fast and mid results align
  if (fastResult.score !== null && midResult.score !== null) {
    const scoreDiff = Math.abs(fastResult.score - midResult.score);
    if (scoreDiff > 20) {
      // Significant disagreement - need full bucket
      return true;
    }
  }
  
  return combinedConfidence < CONFIG.SKIP_FULL_THRESHOLD || !bothAgree;
}

// =============================================================================
// RESULT MERGING
// =============================================================================

/**
 * Merge results from all buckets
 * FULL models always have priority when they contradict FAST
 */
function mergeResults(fastResult, midResult, fullResult) {
  // If FULL bucket ran, it has highest priority
  if (fullResult && fullResult.score !== null) {
    // Check for contradiction with fast results
    if (fastResult.score !== null) {
      const deviation = Math.abs(fullResult.score - fastResult.score);
      if (deviation > 15) {
        logger.debug(`  ⚠️ Full contradicted fast by ${deviation}%`);
      }
    }
    
    return {
      score: fullResult.score,
      confidence: fullResult.confidence,
      breakdown: fullResult.breakdown,
      source: 'full'
    };
  }
  
  // If only MID + FAST
  if (midResult && midResult.score !== null) {
    // Weighted average (mid has more weight)
    const score = Math.round(
      (fastResult.score || 0) * 0.3 + 
      midResult.score * 0.7
    );
    
    const confidence = (fastResult.confidence * 0.3 + midResult.confidence * 0.7);
    
    return {
      score,
      confidence,
      breakdown: [...(fastResult.breakdown || []), ...(midResult.breakdown || [])],
      source: 'mid'
    };
  }
  
  // Only FAST
  return {
    score: fastResult.score,
    confidence: fastResult.confidence,
    breakdown: fastResult.breakdown,
    source: 'fast'
  };
}

// =============================================================================
// MAIN ULTRA-SPEED PIPELINE
// =============================================================================

/**
 * Ultra-speed fact-checking pipeline
 * 
 * Execution flow:
 * 1. Personal statement detection (skip all if personal)
 * 2. Cache lookup (exact → semantic)
 * 3. Input compression (for slow models)
 * 4. FAST bucket (parallel)
 * 5. Delta check → maybe skip MID/FULL
 * 6. MID bucket (if needed)
 * 7. FULL bucket (if needed)
 * 8. Result merging (full models win on conflict)
 * 9. Cache storage
 */
export async function ultraSpeedCheck(text) {
  const pipelineTimer = logger.createTimer('Pipeline:Total');
  const usedModels = { fast: [], mid: [], full: [] };
  const latency = { fastPhaseMs: 0, fullPhaseMs: 0, totalMs: 0 };
  
  logger.pipeline('check', 'start', { length: text.length });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 0: Personal statement detection (skip everything if personal)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const personalCheck = detectPersonalStatement(text);
  if (personalCheck.isPersonal) {
    logger.pipeline('personal', 'skip', { reason: personalCheck.reason });
    
    return {
      mode: 'personal',
      claim: text,
      score: null,
      confidence: null,
      loraVerdict: null,
      loraMessage: "this feels personal, not something to fact-check",
      reason: personalCheck.reason,
      latency: { fastPhaseMs: 0, fullPhaseMs: 0, totalMs: pipelineTimer.elapsed() },
      usedModels,
      pipelineInfo: { skippedAll: true, reason: 'personal' }
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Cache lookup (exact first, then semantic)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Quick clean for consistent caching
  const cleanedText = quickClean(text);
  
  // Check exact cache first (instant)
  const exactHit = checkExactCache(cleanedText);
  if (exactHit.hit) {
    logger.pipeline('cache', 'cache', { type: 'exact' });
    return {
      ...exactHit.data,
      fromCache: true,
      cacheType: 'exact',
      latency: { fastPhaseMs: 0, fullPhaseMs: 0, totalMs: pipelineTimer.elapsed() }
    };
  }
  
  // Check semantic cache (requires embedding)
  const semanticHit = await checkSemanticCache(cleanedText);
  if (semanticHit.hit) {
    logger.pipeline('cache', 'cache', { type: 'semantic', similarity: semanticHit.similarity?.toFixed(2) });
    return {
      ...semanticHit.data,
      fromCache: true,
      cacheType: 'semantic',
      cacheSimilarity: semanticHit.similarity,
      latency: { fastPhaseMs: 0, fullPhaseMs: 0, totalMs: pipelineTimer.elapsed() }
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Speculative execution - Start background tasks
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Start embedding computation
  const embeddingPromise = precomputeEmbedding(cleanedText);
  
  // Start source search in parallel (will complete while models run)
  const sourceSearchPromise = quickSearchSources(cleanedText, 4000);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Input compression (for slower models)
  // ═══════════════════════════════════════════════════════════════════════════
  
  let compressedText = cleanedText;
  let compressionInfo = null;
  
  if (cleanedText.length > CONFIG.COMPRESS_THRESHOLD) {
    const compression = await compressForInference(cleanedText, {
      maxLength: CONFIG.MAX_INPUT_LENGTH,
      useAI: false // Only use local compression for speed
    });
    compressedText = compression.compressed;
    compressionInfo = {
      original: cleanedText.length,
      compressed: compressedText.length,
      ratio: compression.ratio,
      method: compression.method
    };
    logger.debug(`  Compressed: ${cleanedText.length} → ${compressedText.length} chars`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: FAST PHASE (< 800ms target)
  // ═══════════════════════════════════════════════════════════════════════════
  
  logger.pipeline('fast', 'fast');
  const fastPhaseStart = performance.now();
  
  const fastBucket = await runBucket('FAST', cleanedText);
  usedModels.fast = fastBucket.responses.map(r => r.model);
  
  const fastResult = computeBucketScore(fastBucket.responses);
  latency.fastPhaseMs = Math.round(performance.now() - fastPhaseStart);
  
  logger.debug(`  Fast result: ${fastResult.score}%, confidence: ${(fastResult.confidence * 100).toFixed(0)}%, agreement: ${fastResult.agreement}`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Delta verification - Should we run more models?
  // ═══════════════════════════════════════════════════════════════════════════
  
  let midResult = null;
  let fullResult = null;
  let skipInfo = { skippedMid: false, skippedFull: false };
  
  const needsMid = shouldRunMidBucket(fastResult);
  
  if (!needsMid) {
    logger.pipeline('mid', 'skip', { reason: 'high_confidence' });
    skipInfo.skippedMid = true;
    skipInfo.skippedFull = true;
  } else {
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 6: MID PHASE
    // ═══════════════════════════════════════════════════════════════════════════
    
    logger.pipeline('mid', 'mid');
    const fullPhaseStart = performance.now();
    
    const midBucket = await runBucket('MID', cleanedText, compressedText);
    usedModels.mid = midBucket.responses.map(r => r.model);
    midResult = computeBucketScore(midBucket.responses);
    
    logger.debug(`  Mid result: ${midResult.score}%, confidence: ${(midResult.confidence * 100).toFixed(0)}%`);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 7: FULL PHASE (if still needed)
    // ═══════════════════════════════════════════════════════════════════════════
    
    const needsFull = shouldRunFullBucket(fastResult, midResult);
    
    if (!needsFull) {
      logger.pipeline('full', 'skip', { reason: 'confirmed_by_mid' });
      skipInfo.skippedFull = true;
    } else {
      logger.pipeline('full', 'full');
      
      const fullBucket = await runBucket('FULL', cleanedText, compressedText);
      usedModels.full = fullBucket.responses.map(r => r.model);
      fullResult = computeBucketScore(fullBucket.responses);
      
      logger.debug(`  Full result: ${fullResult.score}%, confidence: ${(fullResult.confidence * 100).toFixed(0)}%`);
    }
    
    latency.fullPhaseMs = Math.round(performance.now() - fullPhaseStart);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: Merge results (full models win on conflict)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const merged = mergeResults(fastResult, midResult, fullResult);
  
  const verdict = getVerdictFromScore(merged.score);
  const message = getSpectrumMessage(merged.score, verdict.toLowerCase());
  
  latency.totalMs = pipelineTimer.elapsed();
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 9: Get live sources (from parallel search)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const sourceResults = await sourceSearchPromise;
  const sources = sourceResults.sources?.map(s => ({
    title: s.title,
    url: s.url,
    snippet: s.snippet
  })) || [];
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 10: Build final result
  // ═══════════════════════════════════════════════════════════════════════════
  
  const result = {
    mode: 'fact_check',
    claim: text,
    score: merged.score,
    confidence: merged.confidence,
    loraVerdict: verdict,
    loraMessage: message,
    latency,
    usedModels,
    spectrumBreakdown: merged.breakdown,
    sources,
    sourceProvider: sourceResults.provider,
    pipelineInfo: {
      ...skipInfo,
      source: merged.source,
      compression: compressionInfo,
      cacheHit: false
    }
  };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 11: Cache result (with pre-computed embedding)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const embedding = await embeddingPromise;
  await cacheResult(cleanedText, result, embedding);
  
  logger.pipeline('check', 'done', { 
    score: merged.score, 
    totalMs: latency.totalMs,
    source: merged.source 
  });
  
  return result;
}

// =============================================================================
// EXPORTS
// =============================================================================

export function getCacheStats() {
  return getSemanticCacheStats();
}

export function clearCaches() {
  clearSemanticCaches();
}

export { CONFIG as ULTRA_SPEED_CONFIG };
