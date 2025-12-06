/**
 * Web Search Service
 * 
 * Fetches real, live sources for fact-checking claims.
 * Uses multiple search providers for reliability.
 */

import OpenAI from 'openai';

let openaiClient = null;

function getOpenAI() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// =============================================================================
// PERPLEXITY SEARCH (Primary - includes real-time sources)
// =============================================================================

/**
 * Search using Perplexity API (has real-time web access)
 */
async function searchWithPerplexity(query) {
  if (!process.env.PERPLEXITY_API_KEY) {
    return { success: false, reason: 'no_api_key' };
  }
  
  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a fact-checking assistant. Search for reliable sources about the following claim. 
Return ONLY valid JSON in this exact format:
{
  "sources": [
    {"title": "Source Title", "url": "https://...", "snippet": "Brief relevant quote"},
    {"title": "Source Title", "url": "https://...", "snippet": "Brief relevant quote"}
  ],
  "summary": "Brief summary of what sources say about this claim"
}
Include 2-5 relevant sources. Only include real, verifiable URLs from reputable sources.`
          },
          {
            role: 'user',
            content: `Find reliable sources about this claim: "${query}"`
          }
        ],
        max_tokens: 1000,
        temperature: 0.1
      })
    });
    
    if (!response.ok) {
      return { success: false, reason: `API error: ${response.status}` };
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return { success: false, reason: 'no_content' };
    }
    
    // Parse JSON from response
    try {
      // Extract JSON from response (might have markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          success: true,
          provider: 'perplexity',
          sources: parsed.sources || [],
          summary: parsed.summary || ''
        };
      }
    } catch (parseError) {
      // If parsing fails, extract sources manually
      const urlMatches = content.match(/https?:\/\/[^\s\])"]+/g) || [];
      return {
        success: true,
        provider: 'perplexity',
        sources: urlMatches.slice(0, 5).map(url => ({
          title: extractDomainName(url),
          url,
          snippet: ''
        })),
        summary: content.substring(0, 200)
      };
    }
    
    return { success: false, reason: 'parse_failed' };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

// =============================================================================
// GOOGLE SEARCH (via Custom Search API)
// =============================================================================

/**
 * Search using Google Custom Search API
 */
async function searchWithGoogle(query) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
  
  if (!apiKey || !searchEngineId) {
    return { success: false, reason: 'no_api_key' };
  }
  
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodedQuery}&num=5`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      return { success: false, reason: `API error: ${response.status}` };
    }
    
    const data = await response.json();
    const items = data.items || [];
    
    return {
      success: true,
      provider: 'google',
      sources: items.map(item => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet || ''
      })),
      summary: ''
    };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

// =============================================================================
// BING SEARCH (via Bing Search API)
// =============================================================================

/**
 * Search using Bing Search API
 */
async function searchWithBing(query) {
  const apiKey = process.env.BING_SEARCH_API_KEY;
  
  if (!apiKey) {
    return { success: false, reason: 'no_api_key' };
  }
  
  try {
    const encodedQuery = encodeURIComponent(query);
    const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodedQuery}&count=5`;
    
    const response = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': apiKey
      }
    });
    
    if (!response.ok) {
      return { success: false, reason: `API error: ${response.status}` };
    }
    
    const data = await response.json();
    const results = data.webPages?.value || [];
    
    return {
      success: true,
      provider: 'bing',
      sources: results.map(item => ({
        title: item.name,
        url: item.url,
        snippet: item.snippet || ''
      })),
      summary: ''
    };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

// =============================================================================
// AI-GENERATED SOURCES (Fallback)
// =============================================================================

/**
 * Generate relevant source suggestions using AI
 * (Not real-time, but provides useful references)
 */
async function generateSourceSuggestions(claim) {
  const openai = getOpenAI();
  
  if (!openai) {
    return { success: false, reason: 'no_openai' };
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You suggest authoritative sources for fact-checking claims.
Return ONLY valid JSON with this format:
{
  "sources": [
    {"title": "Source Name", "url": "https://...", "type": "primary|news|academic"},
    ...
  ]
}
Include 3-5 sources. Use REAL, EXISTING URLs from reputable organizations like:
- News: Reuters, AP, BBC, NPR, PBS
- Fact-checkers: Snopes, PolitiFact, FactCheck.org
- Government: CDC, WHO, NASA, .gov sites
- Academic: Nature, Science, university .edu sites
Only include URLs you're confident actually exist.`
        },
        {
          role: 'user',
          content: `Suggest fact-checking sources for: "${claim}"`
        }
      ],
      max_tokens: 500,
      temperature: 0.2
    });
    
    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      return { success: false, reason: 'no_content' };
    }
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        provider: 'ai_suggested',
        sources: parsed.sources || [],
        summary: 'AI-suggested sources (not real-time)'
      };
    }
    
    return { success: false, reason: 'parse_failed' };
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

// =============================================================================
// MAIN SEARCH FUNCTION
// =============================================================================

/**
 * Search for sources related to a claim
 * Tries multiple providers in order of reliability
 */
export async function searchSources(claim) {
  const results = {
    sources: [],
    provider: null,
    searchTime: 0,
    error: null
  };
  
  const startTime = performance.now();
  
  // Try Perplexity first (best for fact-checking, has real-time access)
  const perplexityResult = await searchWithPerplexity(claim);
  if (perplexityResult.success && perplexityResult.sources?.length > 0) {
    results.sources = perplexityResult.sources;
    results.provider = 'perplexity';
    results.summary = perplexityResult.summary;
    results.searchTime = Math.round(performance.now() - startTime);
    return results;
  }
  
  // Try Google
  const googleResult = await searchWithGoogle(claim);
  if (googleResult.success && googleResult.sources?.length > 0) {
    results.sources = googleResult.sources;
    results.provider = 'google';
    results.searchTime = Math.round(performance.now() - startTime);
    return results;
  }
  
  // Try Bing
  const bingResult = await searchWithBing(claim);
  if (bingResult.success && bingResult.sources?.length > 0) {
    results.sources = bingResult.sources;
    results.provider = 'bing';
    results.searchTime = Math.round(performance.now() - startTime);
    return results;
  }
  
  // Fallback to AI-generated suggestions
  const aiResult = await generateSourceSuggestions(claim);
  if (aiResult.success && aiResult.sources?.length > 0) {
    results.sources = aiResult.sources;
    results.provider = 'ai_suggested';
    results.summary = aiResult.summary;
    results.searchTime = Math.round(performance.now() - startTime);
    return results;
  }
  
  // All failed - return empty
  results.error = 'All search providers failed';
  results.searchTime = Math.round(performance.now() - startTime);
  return results;
}

/**
 * Quick search with shorter timeout (for fast pipeline)
 */
export async function quickSearchSources(claim, timeoutMs = 3000) {
  return Promise.race([
    searchSources(claim),
    new Promise(resolve => 
      setTimeout(() => resolve({ sources: [], provider: 'timeout', searchTime: timeoutMs }), timeoutMs)
    )
  ]);
}

// =============================================================================
// HELPERS
// =============================================================================

function extractDomainName(url) {
  try {
    const domain = new URL(url).hostname;
    return domain.replace('www.', '').split('.')[0];
  } catch {
    return 'Unknown';
  }
}

// =============================================================================
// STATIC SOURCES (Fallback for common topics)
// =============================================================================

const FACT_CHECK_SITES = [
  { title: 'Snopes', url: 'https://www.snopes.com/', type: 'fact-checker' },
  { title: 'PolitiFact', url: 'https://www.politifact.com/', type: 'fact-checker' },
  { title: 'FactCheck.org', url: 'https://www.factcheck.org/', type: 'fact-checker' },
  { title: 'AP Fact Check', url: 'https://apnews.com/hub/ap-fact-check', type: 'news' },
  { title: 'Reuters Fact Check', url: 'https://www.reuters.com/fact-check/', type: 'news' }
];

/**
 * Get relevant fact-checking site suggestions
 */
export function getFactCheckSites() {
  return FACT_CHECK_SITES;
}

export default {
  searchSources,
  quickSearchSources,
  getFactCheckSites
};

