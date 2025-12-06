/**
 * LORA — OPTIMIZED MULTI-MODEL PIPELINE
 * 
 * Runs ALL models in PARALLEL for maximum speed
 * Target: ~2-3 seconds for full multi-model consensus
 */

import { lookupClaim, storeClaim, getMemoryStats } from './claimMemory.js';

// =============================================================================
// LAZY LOAD AI CLIENTS (cached for reuse)
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
// UNIFIED PROMPT
// =============================================================================

const ANALYSIS_PROMPT = `You are Lora, a fact-checking AI. Analyze the input and respond in JSON.

TASK:
1. Split into segments (one idea each)
2. Classify: PERSONAL, FACTUAL, NONSENSE, or HARMFUL
3. For non-personal: provide credibility (0-100) and explanation
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

Be warm, conversational. Prioritize warning if harmful.`;

// =============================================================================
// PARALLEL MULTI-MODEL FACT-CHECK
// =============================================================================

async function parallelFactCheck(claims) {
  if (!claims || claims.length === 0) return {};
  
  const claimsText = claims.map((c, i) => `${i}. "${c}"`).join('\n');
  const prompt = `Fact-check these claims. For each provide credibility (0-100) and brief explanation.
Respond in JSON: { "results": [{ "index": 0, "credibility": X, "explanation": "..." }] }

Claims:
${claimsText}`;

  const [openai, anthropic] = await Promise.all([getOpenAI(), getAnthropic()]);

  // Run ALL models in PARALLEL
  const results = await Promise.allSettled([
    // GPT-4o
    openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 1000,
      response_format: { type: 'json_object' }
    }).then(r => ({
      model: 'gpt-4o',
      results: JSON.parse(r.choices[0].message.content).results || []
    })).catch(() => ({ model: 'gpt-4o', results: [] })),

    // Claude
    anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    }).then(r => {
      const text = r.content[0].text;
      const match = text.match(/\{[\s\S]*\}/);
      return {
        model: 'claude',
        results: match ? (JSON.parse(match[0]).results || []) : []
      };
    }).catch(() => ({ model: 'claude', results: [] })),

    // Perplexity (has web search)
    fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    }).then(async r => {
      const json = await r.json();
      const text = json.choices?.[0]?.message?.content || '';
      const match = text.match(/\{[\s\S]*\}/);
      return {
        model: 'perplexity',
        results: match ? (JSON.parse(match[0]).results || []) : []
      };
    }).catch(() => ({ model: 'perplexity', results: [] }))
  ]);

  // Aggregate results
  const modelData = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  const consensus = {};
  
  for (let i = 0; i < claims.length; i++) {
    const scores = [];
    const explanations = [];
    const modelScores = {};
    
    for (const model of modelData) {
      const result = model.results.find(r => r.index === i);
      if (result?.credibility !== undefined) {
        scores.push(result.credibility);
        modelScores[model.model] = result.credibility;
        if (result.explanation) explanations.push(result.explanation);
      }
    }
    
    consensus[i] = {
      credibility: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      explanation: explanations[0] || null,
      modelScores,
      modelsUsed: scores.length
    };
  }
  
  return {
    consensus,
    models: modelData.map(m => m.model)
  };
}

// =============================================================================
// MAIN PIPELINE - Parallel Execution
// =============================================================================

export async function runOptimizedPipeline(input) {
  const startTime = performance.now();
  
  // Validate
  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return { success: false, errorType: 'empty_input' };
  }
  
  // Check cache
  const cacheKey = input.trim().toLowerCase().substring(0, 200);
  const cached = lookupClaim(cacheKey);
  if (cached.hit && cached.data) {
    try {
      const cachedResult = typeof cached.data === 'string' ? JSON.parse(cached.data) : cached.data;
      return {
        ...cachedResult,
        success: true,
        fromCache: true,
        latencyMs: (performance.now() - startTime).toFixed(2)
      };
    } catch (e) {
      // Cache parse failed, continue with fresh analysis
    }
  }

  try {
    const openai = await getOpenAI();
    
    // STEP 1: Quick analysis with GPT-4o-mini (fast segmentation + initial check)
    // Run this WHILE preparing other models
    const analysisPromise = openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: ANALYSIS_PROMPT },
        { role: 'user', content: `Analyze:\n\n"${input}"` }
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    });

    // Wait for initial analysis
    const analysisResponse = await analysisPromise;
    const analysis = JSON.parse(analysisResponse.choices[0].message.content);
    
    // Get factual claims for multi-model verification
    const factualClaims = (analysis.segments || [])
      .filter(s => s.type !== 'PERSONAL')
      .map(s => s.text);
    
    let models = ['gpt-4o-mini'];
    let modelConsensus = null;
    
    // STEP 2: If there are factual claims, verify with multiple models IN PARALLEL
    if (factualClaims.length > 0) {
      const multiModelResult = await parallelFactCheck(factualClaims);
      models = ['gpt-4o-mini', ...multiModelResult.models];
      
      // Update segments with consensus
      analysis.segments = analysis.segments.map(seg => {
        if (seg.type === 'PERSONAL') return seg;
        
        const claimIndex = factualClaims.indexOf(seg.text);
        if (claimIndex !== -1 && multiModelResult.consensus[claimIndex]) {
          const cons = multiModelResult.consensus[claimIndex];
          return {
            ...seg,
            credibility: cons.credibility ?? seg.credibility,
            explanation: cons.explanation || seg.explanation,
            modelScores: cons.modelScores,
            modelsUsed: cons.modelsUsed
          };
        }
        return seg;
      });
      
      // Build consensus array
      modelConsensus = factualClaims.map((claim, i) => ({
        claim,
        ...multiModelResult.consensus[i]
      }));
      
      // Recalculate overall credibility
      const factualSegs = analysis.segments.filter(s => s.credibility !== null);
      if (factualSegs.length > 0) {
        analysis.overallCredibility = Math.round(
          factualSegs.reduce((sum, s) => sum + s.credibility, 0) / factualSegs.length
        );
      }
    }
    
    // Determine mode
    const hasPersonal = analysis.segments?.some(s => s.type === 'PERSONAL');
    const hasFactual = analysis.segments?.some(s => s.type !== 'PERSONAL');
    const hasHarmful = analysis.segments?.some(s => s.type === 'HARMFUL');
    
    let mode;
    if (hasHarmful) mode = 'harmful_detected';
    else if (hasPersonal && hasFactual) mode = 'mixed';
    else if (hasPersonal) mode = 'personal';
    else if (hasFactual) mode = 'fact_check';
    else mode = 'empty';
    
    // NO hardcoded siriResponse - LLM generates it in ANALYSIS_PROMPT
    // Just pass through what the LLM generated
    
    const latencyMs = (performance.now() - startTime).toFixed(2);
    
    const result = {
      success: true,
      mode,
      models,
      
      summary: {
        totalSegments: analysis.segments?.length || 0,
        personal: analysis.segments?.filter(s => s.type === 'PERSONAL').length || 0,
        factual: analysis.segments?.filter(s => s.type === 'FACTUAL').length || 0,
        harmful: analysis.segments?.filter(s => s.type === 'HARMFUL').length || 0,
        overallCredibility: analysis.overallCredibility
      },
      
      segments: analysis.segments,
      modelConsensus,
      
      personalResponse: analysis.personalResponse,
      factCheckResponse: analysis.factCheckSummary,
      loraMessage: analysis.overallMessage,
      siriResponse: analysis.siriResponse,
      
      harmfulWarning: hasHarmful ? {
        detected: true,
        claims: analysis.segments?.filter(s => s.type === 'HARMFUL').map(s => s.text) || []
      } : null,
      
      latencyMs,
      fromCache: false
    };
    
    // Cache result
    storeClaim(cacheKey, analysis.overallCredibility || 50, JSON.stringify(result));
    
    return result;
    
  } catch (error) {
    console.error('[OptimizedPipeline] Error:', error.message);
    return {
      success: false,
      errorType: 'pipeline_error',
      latencyMs: (performance.now() - startTime).toFixed(2)
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { getMemoryStats };

export default {
  runOptimizedPipeline,
  getMemoryStats
};

