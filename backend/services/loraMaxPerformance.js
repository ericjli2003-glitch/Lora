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
import { classifySemanticBatch, getCheckableSegments, hasHarmfulContent } from './semanticClassifier.js';
import { batchLookup, batchStore, getMemoryStats } from './claimMemory.js';
import logger from './logger.js';

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
  // STEP 2: CLASSIFY (Semantic - LLM-based, no regex)
  // ===================
  const classifyStart = performance.now();
  const classification = await classifySemanticBatch(segments);
  timings.classifyMs = (performance.now() - classifyStart).toFixed(2);
  
  // Check for harmful content
  const containsHarmful = hasHarmfulContent(classification);
  
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
      classificationReason: segment.reason,
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
    
    // Handle different classification types
    let defaultCredibility = 50;
    let defaultExplanation = 'could not verify';
    
    if (segment.type === 'NONSENSE') {
      defaultCredibility = 2;
      defaultExplanation = 'fantastical claim — contradicts physical reality';
    } else if (segment.type === 'HARMFUL') {
      defaultCredibility = 5;
      defaultExplanation = '⚠️ potentially harmful misinformation — please verify with trusted sources';
    }
    
    return {
      ...base,
      credibility: result?.credibility ?? defaultCredibility,
      source: result?.fromMemory ? 'memory' : 'fresh',
      explanation: result?.explanation ?? defaultExplanation
    };
  });
  
  timings.combineMs = (performance.now() - combineStart).toFixed(2);
  timings.totalMs = (performance.now() - pipelineStart).toFixed(2);
  
  // ===================
  // STEP 5: OUTPUT
  // ===================
  
  // Calculate overall credibility (only for factual segments)
  const factualResults = analysis.filter(a => a.credibility !== null);
  const personalResults = analysis.filter(a => a.classification === 'PERSONAL');
  const harmfulResults = analysis.filter(a => a.classification === 'HARMFUL');
  const nonsenseResults = analysis.filter(a => a.classification === 'NONSENSE');
  
  const overallCredibility = factualResults.length > 0 ?
    Math.round(factualResults.reduce((sum, a) => sum + a.credibility, 0) / factualResults.length) :
    null;
  
  // Determine mode
  const hasPersonal = personalResults.length > 0;
  const hasFactual = factualResults.length > 0;
  const hasHarmful = harmfulResults.length > 0;
  let mode;
  
  if (hasHarmful) {
    mode = 'harmful_detected'; // Priority: flag dangerous content
  } else if (hasPersonal && hasFactual) {
    mode = 'mixed'; // Personal + Factual
  } else if (hasPersonal) {
    mode = 'personal';
  } else if (hasFactual) {
    mode = segmentation.tikTokMode ? 'tiktok' : 'fact_check';
  } else {
    mode = 'empty';
  }
  
  // ===================
  // STEP 5: GENERATE DYNAMIC RESPONSE (LLM-based, no templates)
  // ===================
  const responseStart = performance.now();
  const dynamicResponse = await generateDynamicResponse(analysis, input);
  timings.responseGenMs = (performance.now() - responseStart).toFixed(2);
  
  timings.totalMs = (performance.now() - pipelineStart).toFixed(2);
  
  return {
    success: true,
    mode,
    tikTokMode: segmentation.tikTokMode,
    
    // Summary
    summary: {
      totalSegments: analysis.length,
      personal: classification.stats.personal,
      factual: classification.stats.factual,
      nonsense: classification.stats.nonsense,
      harmful: classification.stats.harmful || 0,
      checkedFromMemory: factCheckResults.stats.fromMemory || 0,
      freshChecked: factCheckResults.stats.freshChecked || 0,
      overallCredibility
    },
    
    // Harmful content warning
    harmfulWarning: hasHarmful ? {
      detected: true,
      claims: harmfulResults.map(h => h.segment)
    } : null,
    
    // Dynamic LLM-generated responses (no hardcoding)
    personalResponse: dynamicResponse.personalResponse,
    factCheckResponse: dynamicResponse.factCheckResponse,
    factCheckScore: overallCredibility,
    
    // Detailed analysis
    analysis,
    
    // Performance metrics
    timings,
    memory: CONFIG.MEMORY_ENABLED ? getMemoryStats() : null,
    
    // LLM-generated messages (dynamic, not templated)
    loraMessage: dynamicResponse.overallMessage,
    siriResponse: dynamicResponse.siriResponse,
    
    // Action complete marker
    actionComplete: 'Lora AI (Max Performance Edition) executed.'
  };
}

// =============================================================================
// MESSAGE GENERATION
// =============================================================================

/**
 * Generate ALL responses dynamically using LLM
 * No hardcoded templates - fully semantic
 */
async function generateDynamicResponse(analysis, originalInput) {
  try {
    const openai = await getOpenAI();
    
    const prompt = `You are Lora, a warm and helpful AI assistant. Based on this analysis, generate a natural response.

ORIGINAL INPUT: "${originalInput}"

ANALYSIS:
${JSON.stringify(analysis, null, 2)}

Generate a JSON response with:
1. "personalResponse" - If there's personal content, respond warmly and naturally to it (null if no personal content)
2. "factCheckResponse" - If there are factual claims, summarize the fact-check results naturally (null if no factual content)
3. "siriResponse" - A SHORT (1-2 sentences max) spoken response for Siri. Must be natural speech, not robotic. Include the credibility percentage if there are factual claims.
4. "overallMessage" - A friendly combined message that addresses both personal and factual parts naturally

RULES:
- Be warm, friendly, conversational
- If harmful content detected, prioritize warning about it
- Don't be robotic or templated
- Siri response must be speakable (no emoji, short)
- Reference specific claims when relevant

Respond in JSON only.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are Lora, a warm AI assistant. Generate natural, friendly responses. Output JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('[DynamicResponse] Error:', error.message);
    // Minimal fallback
    return {
      personalResponse: null,
      factCheckResponse: null,
      siriResponse: "I analyzed that for you. Check the details in the app.",
      overallMessage: "Here's what I found in my analysis."
    };
  }
}

// All response generation is now done dynamically by generateDynamicResponse()
// No hardcoded message templates

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

