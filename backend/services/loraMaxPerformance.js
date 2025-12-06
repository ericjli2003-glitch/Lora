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
  
  // Generate separate responses for mixed mode
  const personalResponse = hasPersonal ? generatePersonalResponse(personalResults) : null;
  const factCheckResponse = hasFactual ? generateFactCheckResponse(factualResults, overallCredibility, harmfulResults) : null;
  
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
      message: "⚠️ This contains potentially harmful misinformation. Please verify with trusted sources.",
      claims: harmfulResults.map(h => h.segment)
    } : null,
    
    // For mixed mode: separate responses
    personalResponse,
    factCheckResponse,
    factCheckScore: overallCredibility,
    
    // Detailed analysis
    analysis,
    
    // Performance metrics
    timings,
    memory: CONFIG.MEMORY_ENABLED ? getMemoryStats() : null,
    
    // Human-readable combined message
    loraMessage: generateLoraMessage(analysis, overallCredibility, segmentation.tikTokMode),
    
    // Siri-optimized spoken response (short, natural, speakable)
    siriResponse: generateSiriResponse(mode, personalResponse, factCheckResponse, overallCredibility, hasHarmful ? {
      detected: true,
      claims: harmfulResults.map(h => h.segment)
    } : null),
    
    // Action complete marker
    actionComplete: 'Lora AI (Max Performance Edition) executed.'
  };
}

// =============================================================================
// MESSAGE GENERATION
// =============================================================================

/**
 * Generate warm response for personal segments
 */
function generatePersonalResponse(personalSegments) {
  const segments = personalSegments.map(p => p.segment.toLowerCase());
  const allText = segments.join(' ');
  
  let response = '';
  
  // Detect emotional tone
  if (allText.includes('happy') || allText.includes('excited') || allText.includes('love')) {
    response = "aww that's so sweet! sounds like you're having a great time 😊";
  } else if (allText.includes('sad') || allText.includes('upset') || allText.includes('angry')) {
    response = "sending good vibes your way 💙 hope things get better";
  } else if (allText.includes('girlfriend') || allText.includes('boyfriend') || allText.includes('partner')) {
    response = "that's adorable! relationship goals ✨";
  } else if (allText.includes('pizza') || allText.includes('food') || allText.includes('ate') || allText.includes('bought me')) {
    response = "nice! sounds like a good time 🍕";
  } else if (allText.includes('mom') || allText.includes('dad') || allText.includes('family')) {
    response = "family moments are the best 💕";
  } else {
    response = "thanks for sharing! 💭";
  }
  
  return {
    message: response,
    segments: personalSegments.map(p => p.segment),
    tone: 'warm'
  };
}

/**
 * Generate fact-check response for factual segments
 */
function generateFactCheckResponse(factualResults, overallCredibility, harmfulResults = []) {
  const trueClaims = factualResults.filter(f => f.credibility >= 70);
  const falseClaims = factualResults.filter(f => f.credibility < 30);
  const mixedClaims = factualResults.filter(f => f.credibility >= 30 && f.credibility < 70);
  
  let verdict;
  let message;
  
  // Priority: harmful content
  if (harmfulResults.length > 0) {
    verdict = 'HARMFUL';
    message = "⚠️ contains potentially harmful misinformation";
  } else if (overallCredibility >= 80) {
    verdict = 'TRUE';
    message = "these facts check out! ✅";
  } else if (overallCredibility >= 60) {
    verdict = 'MOSTLY_TRUE';
    message = "mostly accurate with some caveats";
  } else if (overallCredibility >= 40) {
    verdict = 'MIXED';
    message = "mixed results — some true, some false ⚠️";
  } else if (overallCredibility >= 20) {
    verdict = 'MOSTLY_FALSE';
    message = "most of these don't hold up ❌";
  } else {
    verdict = 'FALSE';
    message = "these claims are false 🚫";
  }
  
  return {
    score: overallCredibility,
    verdict,
    message,
    breakdown: {
      true: trueClaims.map(c => ({ claim: c.segment, credibility: c.credibility, explanation: c.explanation })),
      false: falseClaims.map(c => ({ claim: c.segment, credibility: c.credibility, explanation: c.explanation })),
      mixed: mixedClaims.map(c => ({ claim: c.segment, credibility: c.credibility, explanation: c.explanation })),
      harmful: harmfulResults.map(c => ({ claim: c.segment, credibility: c.credibility, explanation: c.explanation }))
    },
    totalChecked: factualResults.length
  };
}

/**
 * Generate Siri-optimized spoken response
 * Short, natural, easy to speak aloud
 */
function generateSiriResponse(mode, personalResponse, factCheckResponse, overallCredibility, harmfulWarning) {
  // HARMFUL - Priority warning
  if (mode === 'harmful_detected' || harmfulWarning?.detected) {
    let siri = "Warning! This contains dangerous misinformation. ";
    if (harmfulWarning?.claims?.[0]) {
      const claim = harmfulWarning.claims[0].substring(0, 50);
      siri += `"${claim}" could be harmful. Please check trusted sources.`;
    } else {
      siri += "Please verify this with a doctor or trusted source before acting on it.";
    }
    return siri;
  }
  
  // Pure personal - warm and brief
  if (mode === 'personal') {
    return personalResponse?.message || "That sounds nice! Nothing to fact-check there.";
  }
  
  // Pure fact-check
  if (mode === 'fact_check' || mode === 'tiktok') {
    if (overallCredibility >= 80) {
      return `This checks out! ${overallCredibility} percent accurate.`;
    } else if (overallCredibility >= 50) {
      return `Mixed results. About ${overallCredibility} percent accurate. Some parts are true, others aren't.`;
    } else if (overallCredibility >= 20) {
      return `Heads up, this is mostly false. Only ${overallCredibility} percent accurate.`;
    } else {
      return `This is false. Only ${overallCredibility} percent accurate. I'd double-check this one.`;
    }
  }
  
  // Mixed mode - acknowledge personal, then give fact-check
  if (mode === 'mixed') {
    let siri = "";
    
    // Brief warm acknowledgment
    if (personalResponse?.message) {
      // Shorten for speech
      if (personalResponse.message.includes('sweet')) {
        siri += "That's sweet! ";
      } else if (personalResponse.message.includes('great time')) {
        siri += "Sounds fun! ";
      } else {
        siri += "Nice! ";
      }
    }
    
    // Fact-check result
    siri += "But about those facts: ";
    
    if (overallCredibility >= 80) {
      siri += `they check out, ${overallCredibility} percent accurate.`;
    } else if (overallCredibility >= 50) {
      siri += `mixed results, ${overallCredibility} percent accurate.`;
    } else if (overallCredibility >= 20) {
      siri += `mostly false, only ${overallCredibility} percent accurate.`;
    } else {
      siri += `those are false, only ${overallCredibility} percent accurate.`;
    }
    
    // Add specific callout for worst false claim
    if (factCheckResponse?.breakdown?.false?.length > 0) {
      const worst = factCheckResponse.breakdown.false[0];
      const shortClaim = worst.claim.substring(0, 40);
      siri += ` "${shortClaim}" is not true.`;
    }
    
    return siri;
  }
  
  return "I couldn't analyze that. Try again?";
}

function generateLoraMessage(analysis, overallCredibility, tikTokMode) {
  const factual = analysis.filter(a => a.classification === 'FACTUAL');
  const nonsense = analysis.filter(a => a.classification === 'NONSENSE');
  const personal = analysis.filter(a => a.classification === 'PERSONAL');
  const checkable = [...factual, ...nonsense];
  
  let message = '';
  
  // Handle mixed content (personal + factual)
  const isMixed = personal.length > 0 && checkable.length > 0;
  
  if (isMixed) {
    // Warm response to personal parts first
    message += "💭 love the personal vibes! ";
    
    if (personal.some(p => p.segment.toLowerCase().includes('happy') || 
                          p.segment.toLowerCase().includes('excited') ||
                          p.segment.toLowerCase().includes('love'))) {
      message += "sounds like you're having a good time 😊 ";
    } else if (personal.some(p => p.segment.toLowerCase().includes('girlfriend') || 
                                  p.segment.toLowerCase().includes('boyfriend') ||
                                  p.segment.toLowerCase().includes('pizza'))) {
      message += "that's sweet! ";
    }
    
    message += "\n\nbut you also dropped some facts, so let me check those:\n\n";
  } else if (tikTokMode) {
    message += '🎵 detected chaotic tiktok-style content — let me break this down:\n\n';
  }
  
  // If ALL personal, give warm response
  if (checkable.length === 0) {
    message = "looks like this is all personal/emotional content — nothing to fact-check here! ";
    if (personal.some(p => p.segment.toLowerCase().includes('happy'))) {
      message += "glad you're feeling good though 💭✨";
    } else {
      message += "hope you're doing well 💭";
    }
    return message;
  }
  
  // Fact-check results summary
  if (overallCredibility !== null) {
    if (overallCredibility >= 80) {
      message += `✅ fact-check result: ${overallCredibility}% credible — the facts check out!`;
    } else if (overallCredibility >= 50) {
      message += `⚠️ fact-check result: ${overallCredibility}% credible — mixed results, some true some not`;
    } else if (overallCredibility >= 20) {
      message += `❌ fact-check result: ${overallCredibility}% credible — most of this doesn't hold up`;
    } else {
      message += `🚫 fact-check result: ${overallCredibility}% credible — yeah these claims are false`;
    }
  }
  
  // Add specific callouts for notable false claims
  const falseClaims = checkable.filter(c => c.credibility !== null && c.credibility < 30);
  if (falseClaims.length > 0) {
    message += `\n\n🔍 heads up on these:`;
    for (const claim of falseClaims.slice(0, 3)) {
      message += `\n   • "${claim.segment.substring(0, 50)}${claim.segment.length > 50 ? '...' : ''}" — ${claim.explanation || 'this is false'}`;
    }
  }
  
  // Add specific callouts for true claims
  const trueClaims = checkable.filter(c => c.credibility !== null && c.credibility >= 70);
  if (trueClaims.length > 0 && falseClaims.length > 0) {
    message += `\n\n✓ but these are legit:`;
    for (const claim of trueClaims.slice(0, 2)) {
      message += `\n   • "${claim.segment.substring(0, 50)}${claim.segment.length > 50 ? '...' : ''}"`;
    }
  }
  
  if (nonsense.length > 0 && !isMixed) {
    message += `\n\n🦄 found ${nonsense.length} fantastical claim(s) that can't be true`;
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

