/**
 * LORA — TIERED FACT-CHECKING PIPELINE
 * 
 * FREE TIER: Fast single-model (GPT-4o-mini) ~1-2s
 * PREMIUM TIER: Multi-model consensus (GPT-4 + Claude + Perplexity) ~3-4s
 */

import { batchLookup, batchStore, getMemoryStats, lookupClaim, storeClaim } from './claimMemory.js';

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
// PROMPTS
// =============================================================================

const ANALYSIS_PROMPT = `You are Lora, a fact-checking AI. Analyze the input and respond in JSON.

TASK:
1. Split into segments (one idea each)
2. Classify: PERSONAL, FACTUAL, NONSENSE, or HARMFUL
3. For FACTUAL/NONSENSE/HARMFUL: provide credibility (0-100) and explanation
4. Generate friendly responses

RESPOND WITH:
{
  "segments": [
    { "text": "...", "type": "PERSONAL|FACTUAL|NONSENSE|HARMFUL", "credibility": null|0-100, "explanation": null|"..." }
  ],
  "overallCredibility": number|null,
  "personalResponse": "warm response"|null,
  "factCheckSummary": "summary"|null,
  "siriResponse": "SHORT 1-2 sentence spoken response",
  "overallMessage": "friendly combined message"
}

Be warm, conversational. Prioritize warning if harmful content detected.`;

const FACT_CHECK_PROMPT = `Fact-check these claims. For each, provide:
- credibility: 0-100 (0=false, 100=true)
- explanation: brief reason

Respond in JSON: { "results": [{ "index": 0, "credibility": X, "explanation": "..." }] }`;

// =============================================================================
// FREE TIER - Single Model (Fast)
// =============================================================================

async function runFreeTier(input) {
  const startTime = performance.now();
  
  const openai = await getOpenAI();
  
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: ANALYSIS_PROMPT },
      { role: 'user', content: `Analyze:\n\n"${input}"` }
    ],
    temperature: 0.3,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });

  const result = JSON.parse(response.choices[0].message.content);
  
  return {
    ...result,
    tier: 'free',
    models: ['gpt-4o-mini'],
    latencyMs: (performance.now() - startTime).toFixed(2)
  };
}

// =============================================================================
// PREMIUM TIER - Multi-Model Consensus
// =============================================================================

async function runPremiumTier(input) {
  const startTime = performance.now();
  
  const [openai, anthropic] = await Promise.all([getOpenAI(), getAnthropic()]);
  
  // Step 1: Quick analysis with GPT-4o-mini (for segmentation)
  const analysisResponse = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: ANALYSIS_PROMPT },
      { role: 'user', content: `Analyze:\n\n"${input}"` }
    ],
    temperature: 0.3,
    max_tokens: 1500,
    response_format: { type: 'json_object' }
  });
  
  const analysis = JSON.parse(analysisResponse.choices[0].message.content);
  
  // Step 2: Get factual claims for multi-model verification
  const factualClaims = (analysis.segments || [])
    .filter(s => s.type !== 'PERSONAL')
    .map((s, i) => ({ index: i, text: s.text }));
  
  if (factualClaims.length === 0) {
    // No factual claims - return analysis as-is
    return {
      ...analysis,
      tier: 'premium',
      models: ['gpt-4o-mini'],
      modelConsensus: null,
      latencyMs: (performance.now() - startTime).toFixed(2)
    };
  }
  
  // Step 3: Multi-model fact-checking in PARALLEL
  const claimsText = factualClaims.map((c, i) => `${i}. "${c.text}"`).join('\n');
  
  const [gpt4Result, claudeResult, perplexityResult] = await Promise.allSettled([
    // GPT-4o
    openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: FACT_CHECK_PROMPT },
        { role: 'user', content: `Claims:\n${claimsText}` }
      ],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    }).then(r => ({ model: 'gpt-4o', data: JSON.parse(r.choices[0].message.content) })),
    
    // Claude
    anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        { role: 'user', content: `${FACT_CHECK_PROMPT}\n\nClaims:\n${claimsText}` }
      ]
    }).then(r => {
      const text = r.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      return { model: 'claude-3-5-sonnet', data: match ? JSON.parse(match[0]) : { results: [] } };
    }),
    
    // Perplexity (with web search)
    fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { role: 'system', content: FACT_CHECK_PROMPT },
          { role: 'user', content: `Claims:\n${claimsText}` }
        ],
        temperature: 0.1
      })
    }).then(async r => {
      const json = await r.json();
      const text = json.choices?.[0]?.message?.content || '{}';
      const match = text.match(/\{[\s\S]*\}/);
      return { model: 'perplexity-sonar', data: match ? JSON.parse(match[0]) : { results: [] } };
    })
  ]);
  
  // Step 4: Aggregate results from all models
  const modelResults = [gpt4Result, claudeResult, perplexityResult]
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
  
  const usedModels = modelResults.map(r => r.model);
  
  // Build consensus for each claim
  const consensus = factualClaims.map((claim, idx) => {
    const scores = [];
    const explanations = [];
    
    for (const result of modelResults) {
      const claimResult = result.data?.results?.find(r => r.index === idx);
      if (claimResult?.credibility !== undefined) {
        scores.push(claimResult.credibility);
        if (claimResult.explanation) explanations.push(claimResult.explanation);
      }
    }
    
    const avgCredibility = scores.length > 0 
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : null;
    
    // Calculate agreement (how much models agree)
    const agreement = scores.length > 1
      ? Math.round(100 - (Math.max(...scores) - Math.min(...scores)))
      : null;
    
    return {
      claim: claim.text,
      credibility: avgCredibility,
      modelScores: Object.fromEntries(modelResults.map((r, i) => [
        r.model, 
        r.data?.results?.find(res => res.index === idx)?.credibility ?? null
      ])),
      agreement,
      explanation: explanations[0] || null,
      modelsUsed: scores.length
    };
  });
  
  // Step 5: Update analysis with consensus results
  const updatedSegments = analysis.segments.map(seg => {
    if (seg.type === 'PERSONAL') return seg;
    
    const consensusResult = consensus.find(c => c.claim === seg.text);
    if (consensusResult) {
      return {
        ...seg,
        credibility: consensusResult.credibility,
        explanation: consensusResult.explanation,
        modelScores: consensusResult.modelScores,
        agreement: consensusResult.agreement
      };
    }
    return seg;
  });
  
  // Recalculate overall credibility from consensus
  const factualResults = updatedSegments.filter(s => s.credibility !== null);
  const overallCredibility = factualResults.length > 0
    ? Math.round(factualResults.reduce((sum, s) => sum + s.credibility, 0) / factualResults.length)
    : null;
  
  // Generate premium response with consensus info
  const premiumSiriResponse = generatePremiumSiriResponse(overallCredibility, usedModels.length, consensus);
  
  return {
    segments: updatedSegments,
    overallCredibility,
    personalResponse: analysis.personalResponse,
    factCheckSummary: analysis.factCheckSummary,
    siriResponse: premiumSiriResponse,
    overallMessage: analysis.overallMessage,
    tier: 'premium',
    models: usedModels,
    modelConsensus: consensus,
    latencyMs: (performance.now() - startTime).toFixed(2)
  };
}

function generatePremiumSiriResponse(credibility, modelCount, consensus) {
  if (credibility === null) {
    return "I checked this with multiple AI models but couldn't verify the claims.";
  }
  
  const agreementAvg = consensus.filter(c => c.agreement).length > 0
    ? Math.round(consensus.filter(c => c.agreement).reduce((sum, c) => sum + c.agreement, 0) / consensus.filter(c => c.agreement).length)
    : null;
  
  let response = `I checked this with ${modelCount} AI models. `;
  
  if (credibility >= 80) {
    response += `They agree it's ${credibility}% credible.`;
  } else if (credibility >= 50) {
    response += `Mixed results at ${credibility}% credible.`;
  } else {
    response += `They agree this is mostly false, only ${credibility}% credible.`;
  }
  
  if (agreementAvg !== null && agreementAvg < 70) {
    response += " The models disagreed on some points.";
  }
  
  return response;
}

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

/**
 * Run Lora fact-checking pipeline
 * @param {string} input - Text to analyze
 * @param {Object} options - { premium: boolean }
 */
export async function runTieredPipeline(input, options = {}) {
  const startTime = performance.now();
  const isPremium = options.premium === true;
  
  // Validate
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return {
      success: false,
      errorType: 'empty_input'
    };
  }
  
  // Check cache
  const cacheKey = `${isPremium ? 'premium' : 'free'}:${input.trim().toLowerCase()}`;
  const cached = lookupClaim(cacheKey);
  if (cached.hit) {
    return {
      success: true,
      ...cached.data,
      fromCache: true,
      latencyMs: (performance.now() - startTime).toFixed(2)
    };
  }
  
  try {
    // Run appropriate tier
    const result = isPremium 
      ? await runPremiumTier(input)
      : await runFreeTier(input);
    
    // Determine mode
    const hasPersonal = result.segments?.some(s => s.type === 'PERSONAL');
    const hasFactual = result.segments?.some(s => s.type !== 'PERSONAL');
    const hasHarmful = result.segments?.some(s => s.type === 'HARMFUL');
    
    let mode;
    if (hasHarmful) mode = 'harmful_detected';
    else if (hasPersonal && hasFactual) mode = 'mixed';
    else if (hasPersonal) mode = 'personal';
    else if (hasFactual) mode = 'fact_check';
    else mode = 'empty';
    
    const finalResult = {
      success: true,
      mode,
      tier: result.tier,
      models: result.models,
      
      summary: {
        totalSegments: result.segments?.length || 0,
        personal: result.segments?.filter(s => s.type === 'PERSONAL').length || 0,
        factual: result.segments?.filter(s => s.type === 'FACTUAL').length || 0,
        harmful: result.segments?.filter(s => s.type === 'HARMFUL').length || 0,
        overallCredibility: result.overallCredibility
      },
      
      segments: result.segments,
      modelConsensus: result.modelConsensus || null,
      
      personalResponse: result.personalResponse,
      factCheckResponse: result.factCheckSummary,
      loraMessage: result.overallMessage,
      siriResponse: result.siriResponse,
      
      harmfulWarning: hasHarmful ? {
        detected: true,
        claims: result.segments?.filter(s => s.type === 'HARMFUL').map(s => s.text) || []
      } : null,
      
      latencyMs: result.latencyMs,
      fromCache: false
    };
    
    // Cache result
    storeClaim(cacheKey, result.overallCredibility || 0, JSON.stringify(finalResult));
    
    return finalResult;
    
  } catch (error) {
    console.error(`[Tiered Pipeline] Error:`, error.message);
    return {
      success: false,
      errorType: 'pipeline_error'
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { getMemoryStats };

export default {
  runTieredPipeline,
  getMemoryStats
};

