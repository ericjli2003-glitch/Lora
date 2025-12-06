/**
 * LORA AI — MAXIMUM PERFORMANCE FACT-CHECKING SUITE
 * 
 * Features:
 * (1) Speed Optimizations - Target <20ms for cached, <2s for fresh
 * (2) GPU Batch Parallel Routing - Parallel model calls
 * (3) Agentic Memory - Previously seen claims
 * (4) TikTok Mode - Chaotic multi-claim content
 * (5) Mixed Input Segmentation + Classification + Fact Checking
 */

import { segmentInput, detectTikTokMode } from './segmenter.js';
import { classifyBatch, getCheckableSegments } from './claimClassifier.js';
import { batchLookup, batchStore, getMemoryStats } from './claimMemory.js';
import { logger } from './logger.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Enable speed mode (compress reasoning, early exits)
  SPEED_MODE: true,
  
  // Enable parallel batch checking
  BATCH_PARALLEL: true,
  
  // Enable agentic memory
  MEMORY_ENABLED: true,
  
  // Maximum segments to process (prevent DoS)
  MAX_SEGMENTS: 50,
  
  // Timeout for batch fact-check (ms)
  BATCH_TIMEOUT: 5000,
  
  // Model configuration for batch checking
  MODELS: {
    FAST: ['gpt-4o-mini'],
    FULL: ['gpt-4o', 'claude-3-5-sonnet-20241022']
  }
};

// =============================================================================
// LAZY LOAD AI CLIENTS
// =============================================================================

let openaiClient = null;
let anthropicClient = null;

async function getOpenAI() {
  if (!openaiClient) {
    const { default: OpenAI } = await import('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

async function getAnthropic() {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

// =============================================================================
// GPU BATCH FACT-CHECKING
// =============================================================================

/**
 * Fast fact-check using GPT-4o-mini
 */
async function fastFactCheck(claims) {
  if (!claims.length) return [];
  
  const openai = await getOpenAI();
  
  const prompt = `You are a rapid fact-checker. For each claim below, provide a credibility score (0-100) and ONE sentence explanation.

CLAIMS:
${claims.map((c, i) => `${i + 1}. "${c.segment}"`).join('\n')}

Respond in JSON format:
{
  "results": [
    { "index": 1, "credibility": 85, "explanation": "..." },
    ...
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a fast, accurate fact-checker. Be concise.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    return parsed.results || [];
  } catch (error) {
    logger.error('Fast fact-check error:', error.message);
    return claims.map((_, i) => ({ 
      index: i + 1, 
      credibility: 50, 
      explanation: 'Could not verify - please check manually' 
    }));
  }
}

/**
 * Full fact-check using multiple models in parallel
 */
async function fullFactCheck(claims) {
  if (!claims.length) return [];
  
  const [openai, anthropic] = await Promise.all([getOpenAI(), getAnthropic()]);
  
  const prompt = `Fact-check each claim. Return JSON with credibility (0-100) and explanation.

CLAIMS:
${claims.map((c, i) => `${i + 1}. "${c.segment}"`).join('\n')}

Format: { "results": [{ "index": 1, "credibility": X, "explanation": "..." }] }`;

  const modelChecks = await Promise.allSettled([
    // GPT-4o
    openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    }).then(r => ({ model: 'gpt-4o', results: JSON.parse(r.choices[0].message.content).results })),
    
    // Claude
    anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    }).then(r => {
      const text = r.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      return { model: 'claude', results: jsonMatch ? JSON.parse(jsonMatch[0]).results : [] };
    })
  ]);

  // Aggregate results from all models
  const aggregated = new Map();
  
  for (const result of modelChecks) {
    if (result.status === 'fulfilled' && result.value.results) {
      for (const item of result.value.results) {
        const key = item.index;
        if (!aggregated.has(key)) {
          aggregated.set(key, { scores: [], explanations: [] });
        }
        aggregated.get(key).scores.push(item.credibility);
        aggregated.get(key).explanations.push(item.explanation);
      }
    }
  }

  // Average scores and combine explanations
  return claims.map((claim, i) => {
    const data = aggregated.get(i + 1) || { scores: [50], explanations: ['Could not verify'] };
    const avgScore = Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length);
    
    return {
      index: i + 1,
      credibility: avgScore,
      explanation: data.explanations[0],
      modelCount: data.scores.length
    };
  });
}

/**
 * Batch fact-check with memory lookup
 */
async function batchFactCheck(checkableSegments, options = {}) {
  const startTime = performance.now();
  
  // Step 1: Memory lookup
  let fromMemory = [];
  let needsCheck = checkableSegments;
  
  if (CONFIG.MEMORY_ENABLED) {
    const memoryResult = batchLookup(checkableSegments);
    fromMemory = memoryResult.fromMemory;
    needsCheck = memoryResult.needsCheck;
  }
  
  // Step 2: Fact-check uncached claims
  let freshResults = [];
  
  if (needsCheck.length > 0) {
    if (options.speedMode && needsCheck.length <= 5) {
      // Fast mode for small batches
      freshResults = await fastFactCheck(needsCheck);
    } else {
      // Full parallel check for larger batches
      freshResults = await fullFactCheck(needsCheck);
    }
    
    // Map results back to segments
    freshResults = needsCheck.map((segment, i) => ({
      ...segment,
      credibility: freshResults[i]?.credibility ?? 50,
      explanation: freshResults[i]?.explanation ?? 'Could not verify',
      fromMemory: false
    }));
    
    // Store fresh results in memory
    if (CONFIG.MEMORY_ENABLED) {
      batchStore(freshResults);
    }
  }
  
  const elapsed = performance.now() - startTime;
  
  return {
    results: [...fromMemory, ...freshResults],
    stats: {
      fromMemory: fromMemory.length,
      freshChecked: freshResults.length,
      batchTimeMs: elapsed.toFixed(2)
    }
  };
}

// =============================================================================
// MAIN PIPELINE
// =============================================================================

/**
 * Run the full Lora Max Performance pipeline
 * @param {string} input - Raw input text
 * @param {Object} options - Pipeline options
 * @returns {Object} Full analysis result
 */
export async function runMaxPerformancePipeline(input, options = {}) {
  const pipelineStart = performance.now();
  const timings = {};
  
  // Validate input
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return {
      success: false,
      error: 'Empty or invalid input',
      timings: { totalMs: 0 }
    };
  }

  // ===================
  // STEP 1: SEGMENT
  // ===================
  const segmentStart = performance.now();
  const segmentation = segmentInput(input, { 
    forceTikTok: options.forceTikTok 
  });
  timings.segmentMs = (performance.now() - segmentStart).toFixed(2);
  
  if (segmentation.segments.length === 0) {
    return {
      success: true,
      mode: 'empty',
      message: "couldn't find any claims to check in that",
      segments: [],
      timings: { totalMs: (performance.now() - pipelineStart).toFixed(2) }
    };
  }
  
  // Limit segments to prevent abuse
  const segments = segmentation.segments.slice(0, CONFIG.MAX_SEGMENTS);
  
  // ===================
  // STEP 2: CLASSIFY
  // ===================
  const classifyStart = performance.now();
  const classification = classifyBatch(segments);
  timings.classifyMs = (performance.now() - classifyStart).toFixed(2);
  
  // ===================
  // STEP 3: FACT-CHECK
  // ===================
  const checkableSegments = getCheckableSegments(classification);
  
  let factCheckResults = { results: [], stats: {} };
  
  if (checkableSegments.length > 0) {
    const checkStart = performance.now();
    factCheckResults = await batchFactCheck(checkableSegments, {
      speedMode: CONFIG.SPEED_MODE && options.speedMode !== false
    });
    timings.factCheckMs = (performance.now() - checkStart).toFixed(2);
  }
  
  // ===================
  // STEP 4: COMBINE
  // ===================
  const combineStart = performance.now();
  
  // Build final analysis
  const analysis = classification.classified.map(segment => {
    const base = {
      segment: segment.segment,
      classification: segment.type,
      factCheck: segment.type !== 'PERSONAL',
    };
    
    if (segment.type === 'PERSONAL') {
      return {
        ...base,
        credibility: null,
        source: null,
        explanation: 'personal content — not fact-checkable'
      };
    }
    
    // Find fact-check result
    const result = factCheckResults.results.find(
      r => r.normalized === segment.normalized || r.segment === segment.segment
    );
    
    return {
      ...base,
      credibility: result?.credibility ?? (segment.type === 'NONSENSE' ? 2 : 50),
      source: result?.fromMemory ? 'memory' : 'fresh',
      explanation: result?.explanation ?? 
        (segment.type === 'NONSENSE' ? 'fantastical claim — very unlikely to be true' : 'could not verify')
    };
  });
  
  timings.combineMs = (performance.now() - combineStart).toFixed(2);
  timings.totalMs = (performance.now() - pipelineStart).toFixed(2);
  
  // ===================
  // STEP 5: OUTPUT
  // ===================
  
  // Calculate overall credibility (only for factual segments)
  const factualResults = analysis.filter(a => a.credibility !== null);
  const overallCredibility = factualResults.length > 0 ?
    Math.round(factualResults.reduce((sum, a) => sum + a.credibility, 0) / factualResults.length) :
    null;
  
  return {
    success: true,
    mode: segmentation.tikTokMode ? 'tiktok' : 'standard',
    tikTokMode: segmentation.tikTokMode,
    
    // Summary
    summary: {
      totalSegments: analysis.length,
      personal: classification.stats.personal,
      factual: classification.stats.factual,
      nonsense: classification.stats.nonsense,
      checkedFromMemory: factCheckResults.stats.fromMemory || 0,
      freshChecked: factCheckResults.stats.freshChecked || 0,
      overallCredibility
    },
    
    // Detailed analysis
    analysis,
    
    // Performance metrics
    timings,
    memory: CONFIG.MEMORY_ENABLED ? getMemoryStats() : null,
    
    // Human-readable message
    loraMessage: generateLoraMessage(analysis, overallCredibility, segmentation.tikTokMode),
    
    // Action complete marker
    actionComplete: 'Lora AI (Max Performance Edition) executed.'
  };
}

// =============================================================================
// MESSAGE GENERATION
// =============================================================================

function generateLoraMessage(analysis, overallCredibility, tikTokMode) {
  const factual = analysis.filter(a => a.classification === 'FACTUAL');
  const nonsense = analysis.filter(a => a.classification === 'NONSENSE');
  const personal = analysis.filter(a => a.classification === 'PERSONAL');
  
  let message = '';
  
  if (tikTokMode) {
    message += '🎵 detected chaotic tiktok-style content — segmented into individual claims\n\n';
  }
  
  if (factual.length === 0 && nonsense.length === 0) {
    message += "looks like this is all personal/emotional content — nothing to fact-check here 💭";
    return message;
  }
  
  if (overallCredibility !== null) {
    if (overallCredibility >= 80) {
      message += `✅ overall credibility: ${overallCredibility}% — looking pretty solid`;
    } else if (overallCredibility >= 50) {
      message += `⚠️ overall credibility: ${overallCredibility}% — mixed signals, some things check out`;
    } else {
      message += `❌ overall credibility: ${overallCredibility}% — most of this doesn't hold up`;
    }
  }
  
  if (nonsense.length > 0) {
    message += `\n\n🦄 found ${nonsense.length} fantastical/impossible claim(s)`;
  }
  
  if (personal.length > 0) {
    message += `\n\n💭 skipped ${personal.length} personal segment(s)`;
  }
  
  return message;
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  CONFIG as MAX_PERFORMANCE_CONFIG,
  batchFactCheck,
  getMemoryStats
};

export default {
  runMaxPerformancePipeline,
  CONFIG,
  batchFactCheck,
  getMemoryStats
};

