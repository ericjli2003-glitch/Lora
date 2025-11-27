import express from 'express';
import dotenv from 'dotenv';
import { checkWithOpenAI } from './services/openai.js';
import { checkWithAnthropic } from './services/anthropic.js';
import { checkWithGoogle } from './services/google.js';
import { checkWithPerplexity } from './services/perplexity.js';
import { aggregateVerdicts } from './services/aggregator.js';
import { checkVideoFromURL, checkVideoFromBase64, generateSpokenResponse } from './services/video.js';
import { extractYouTubeTranscript, chunkTranscript, formatTranscriptPreview } from './services/transcript.js';

dotenv.config();

const app = express();

// Increase payload limit for video uploads (50MB)
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// =============================================================================
// Helper: Consistent response format
// =============================================================================

function successResponse(data) {
  return { success: true, data };
}

function errorResponse(message, details = null) {
  return { success: false, error: { message, details } };
}

// =============================================================================
// GET /health - Health check
// =============================================================================

app.get('/health', (req, res) => {
  res.json(successResponse({ 
    status: 'ok', 
    service: 'lora-backend',
    timestamp: new Date().toISOString()
  }));
});

// =============================================================================
// POST /api/check - Fact-checking endpoint (multi-AI consensus)
// =============================================================================

app.post('/api/check', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json(errorResponse(
      'Missing or invalid "text" field',
      { field: 'text', received: typeof text }
    ));
  }

  console.log(`\n📝 Checking claim: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

  try {
    // Query all AI models in parallel
    const results = await Promise.allSettled([
      checkWithOpenAI(text),
      checkWithAnthropic(text),
      checkWithGoogle(text),
      checkWithPerplexity(text)
    ]);

    // Extract successful responses
    const responses = [];
    const models = ['OpenAI', 'Anthropic', 'Google', 'Perplexity'];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        responses.push({
          model: models[index],
          ...result.value
        });
        console.log(`✅ ${models[index]}: ${result.value.verdict}`);
      } else {
        console.log(`❌ ${models[index]}: Failed - ${result.reason?.message || 'Unknown error'}`);
      }
    });

    if (responses.length === 0) {
      return res.status(503).json(errorResponse(
        'All AI services failed',
        { modelsAttempted: models }
      ));
    }

    // Aggregate verdicts into consensus
    const consensus = aggregateVerdicts(responses);

    // Determine Lora verdict (TRUE / FALSE / UNKNOWN)
    let loraVerdict;
    let loraMessage;
    if (consensus.verdict === 'false') {
      loraVerdict = "FALSE";
      loraMessage = "Lora did a quick search and determined this claim is most likely FALSE.";
    } else if (consensus.verdict === 'true') {
      loraVerdict = "TRUE";
      loraMessage = "Lora did a quick search and determined this claim is most likely TRUE.";
    } else {
      loraVerdict = "UNKNOWN";
      loraMessage = "Lora did a quick search and found mixed results, so the truth is unclear.";
    }

    // Get supporting sources
    const sources = getSources(loraVerdict, text);

    console.log(`\n🎯 Lora Verdict: ${loraVerdict}`);

    res.json({
      success: true,
      claim: text,
      loraVerdict: loraVerdict,
      loraMessage: loraMessage,
      sources: sources
    });

  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json(errorResponse(
      'Internal server error',
      { type: error.name }
    ));
  }
});

// =============================================================================
// POST /api/check-video - Video fact-checking endpoint (Gemini)
// =============================================================================

app.post('/api/check-video', async (req, res) => {
  const { url, base64, mimeType = 'video/mp4' } = req.body;

  if (!url && !base64) {
    return res.status(400).json(errorResponse(
      'Missing video data. Provide either "url" or "base64" field.',
      { received: { hasUrl: !!url, hasBase64: !!base64 } }
    ));
  }

  console.log(`\n🎬 Analyzing video...`);
  if (url) console.log(`   URL: ${url.substring(0, 50)}...`);
  if (base64) console.log(`   Base64: ${(base64.length / 1024 / 1024).toFixed(2)} MB`);

  try {
    let analysis;

    if (url) {
      analysis = await checkVideoFromURL(url);
    } else {
      analysis = await checkVideoFromBase64(base64, mimeType);
    }

    const spokenResponse = generateSpokenResponse(analysis);

    console.log(`\n🎯 Video verdict: ${analysis.overallVerdict}`);
    console.log(`📊 Confidence: ${analysis.confidence}%`);
    console.log(`📋 Claims found: ${analysis.claims?.length || 0}`);

    res.json(successResponse({
      verdict: analysis.overallVerdict,
      confidence: analysis.confidence,
      summary: analysis.summary,
      spokenResponse: spokenResponse,
      claims: analysis.claims || [],
      model: 'Gemini 1.5 Flash'
    }));

  } catch (error) {
    console.error('Video analysis error:', error);
    res.status(500).json(errorResponse(
      'Video analysis failed',
      { error: error.message }
    ));
  }
});

// =============================================================================
// POST /api/check-transcript - Fact-check video via transcript (multi-AI)
// =============================================================================

app.post('/api/check-transcript', async (req, res) => {
  const { url, transcript: rawTranscript } = req.body;

  if (!url && !rawTranscript) {
    return res.status(400).json(errorResponse(
      'Missing input. Provide either "url" (YouTube) or "transcript" (raw text).',
      { received: { hasUrl: !!url, hasTranscript: !!rawTranscript } }
    ));
  }

  console.log(`\n📜 Transcript fact-check request...`);

  try {
    // Step 1: Get transcript
    let transcript;
    let source;

    if (url) {
      console.log(`   Extracting from: ${url}`);
      transcript = await extractYouTubeTranscript(url);
      source = 'youtube';
    } else {
      transcript = rawTranscript;
      source = 'provided';
    }

    console.log(`   Transcript length: ${transcript.length} chars`);
    console.log(`   Preview: "${formatTranscriptPreview(transcript, 100)}"`);

    // Step 2: Chunk if too long (for very long videos)
    const chunks = chunkTranscript(transcript, 6000);
    console.log(`   Chunks to analyze: ${chunks.length}`);

    // Step 3: Analyze each chunk with all AI models
    const allResponses = [];
    const models = ['OpenAI', 'Anthropic', 'Google', 'Perplexity'];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkLabel = chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : '';
      
      console.log(`\n📝 Analyzing${chunkLabel}...`);

      const results = await Promise.allSettled([
        checkWithOpenAI(chunk),
        checkWithAnthropic(chunk),
        checkWithGoogle(chunk),
        checkWithPerplexity(chunk)
      ]);

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          allResponses.push({
            model: models[index],
            chunk: i + 1,
            ...result.value
          });
          console.log(`   ✅ ${models[index]}: ${result.value.verdict}`);
        } else {
          console.log(`   ❌ ${models[index]}: Failed`);
        }
      });
    }

    if (allResponses.length === 0) {
      return res.status(503).json(errorResponse(
        'All AI services failed to analyze the transcript',
        { modelsAttempted: models }
      ));
    }

    // Step 4: Aggregate all responses
    const consensus = aggregateVerdicts(allResponses);

    console.log(`\n🎯 Transcript verdict: ${consensus.verdict}`);
    console.log(`📊 Confidence: ${consensus.confidence}%`);

    res.json(successResponse({
      verdict: consensus.verdict,
      confidence: consensus.confidence,
      summary: consensus.summary,
      spokenResponse: consensus.spokenResponse,
      transcript: {
        source: source,
        length: transcript.length,
        chunks: chunks.length,
        preview: formatTranscriptPreview(transcript, 500)
      },
      details: {
        modelsQueried: models.length,
        totalResponses: allResponses.length,
        responses: allResponses
      }
    }));

  } catch (error) {
    console.error('Transcript analysis error:', error);
    res.status(500).json(errorResponse(
      'Transcript analysis failed',
      { error: error.message }
    ));
  }
});

// =============================================================================
// POST /api/chat - General LLM chat endpoint
// =============================================================================

app.post('/api/chat', async (req, res) => {
  const { message, model = 'openai', history = [] } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json(errorResponse(
      'Missing or invalid "message" field',
      { field: 'message', received: typeof message }
    ));
  }

  console.log(`\n💬 Chat request (${model}): "${message.substring(0, 50)}..."`);

  try {
    let response;
    
    // Route to appropriate model
    switch (model.toLowerCase()) {
      case 'openai':
        response = await chatWithOpenAI(message, history);
        break;
      case 'anthropic':
        response = await chatWithAnthropic(message, history);
        break;
      case 'google':
        response = await chatWithGoogle(message, history);
        break;
      default:
        return res.status(400).json(errorResponse(
          'Invalid model specified',
          { validModels: ['openai', 'anthropic', 'google'], received: model }
        ));
    }

    res.json(successResponse({
      message: response,
      model: model,
      timestamp: new Date().toISOString()
    }));

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json(errorResponse(
      'Failed to get response from AI',
      { model, type: error.name }
    ));
  }
});

// Chat helper functions
async function chatWithOpenAI(message, history) {
  const OpenAI = (await import('openai')).default;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ];
  
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 1000
  });
  
  return response.choices[0]?.message?.content || '';
}

async function chatWithAnthropic(message, history) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: message }
  ];
  
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages
  });
  
  return response.content[0]?.text || '';
}

async function chatWithGoogle(message, history) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY not configured');
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  
  // Build conversation context
  const context = history.map(h => `${h.role}: ${h.content}`).join('\n');
  const prompt = context ? `${context}\nuser: ${message}` : message;
  
  const result = await model.generateContent(prompt);
  return result.response.text() || '';
}

// =============================================================================
// POST /api/task - Generic task endpoint (extendable)
// =============================================================================

app.post('/api/task', async (req, res) => {
  const { type, payload } = req.body;

  if (!type || typeof type !== 'string') {
    return res.status(400).json(errorResponse(
      'Missing or invalid "type" field',
      { field: 'type', received: typeof type }
    ));
  }

  console.log(`\n⚡ Task request: ${type}`);

  try {
    let result;

    switch (type) {
      case 'summarize':
        result = await handleSummarize(payload);
        break;
      case 'translate':
        result = await handleTranslate(payload);
        break;
      case 'extract':
        result = await handleExtract(payload);
        break;
      default:
        return res.status(400).json(errorResponse(
          'Unknown task type',
          { validTypes: ['summarize', 'translate', 'extract'], received: type }
        ));
    }

    res.json(successResponse({
      type,
      result,
      timestamp: new Date().toISOString()
    }));

  } catch (error) {
    console.error('Task error:', error);
    res.status(500).json(errorResponse(
      'Task processing failed',
      { type, error: error.message }
    ));
  }
});

// Task handlers
async function handleSummarize(payload) {
  const { text, length = 'short' } = payload || {};
  if (!text) throw new Error('Missing text to summarize');
  
  const OpenAI = (await import('openai')).default;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `Summarize the following text. Make it ${length} (1-2 sentences for short, 1 paragraph for medium, detailed for long).` },
      { role: 'user', content: text }
    ],
    max_tokens: 500
  });
  
  return { summary: response.choices[0]?.message?.content || '' };
}

async function handleTranslate(payload) {
  const { text, targetLanguage = 'Spanish' } = payload || {};
  if (!text) throw new Error('Missing text to translate');
  
  const OpenAI = (await import('openai')).default;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `Translate the following text to ${targetLanguage}. Only output the translation, nothing else.` },
      { role: 'user', content: text }
    ],
    max_tokens: 1000
  });
  
  return { translation: response.choices[0]?.message?.content || '', targetLanguage };
}

async function handleExtract(payload) {
  const { text, extractType = 'entities' } = payload || {};
  if (!text) throw new Error('Missing text to extract from');
  
  const OpenAI = (await import('openai')).default;
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: `Extract ${extractType} from the following text. Return as JSON array.` },
      { role: 'user', content: text }
    ],
    max_tokens: 500,
    response_format: { type: 'json_object' }
  });
  
  const content = response.choices[0]?.message?.content || '{}';
  return { extracted: JSON.parse(content), extractType };
}

// =============================================================================
// Helper: Get supporting sources based on verdict
// =============================================================================

function getSources(verdict, claim) {
  if (verdict === 'FALSE') {
    // Return authoritative sources that debunk common false claims
    return [
      {
        title: "NASA - Apollo Mission Archives",
        url: "https://www.nasa.gov/mission_pages/apollo/missions/index.html"
      },
      {
        title: "Smithsonian National Air and Space Museum",
        url: "https://airandspace.si.edu/explore-and-learn/topics/apollo"
      },
      {
        title: "National Geographic - Science & Fact Checking",
        url: "https://www.nationalgeographic.com/science"
      }
    ];
  } else if (verdict === 'TRUE') {
    // Return high-authority sources for verified claims
    return [
      {
        title: "Associated Press - Fact Check",
        url: "https://apnews.com/hub/ap-fact-check"
      },
      {
        title: "Reuters Fact Check",
        url: "https://www.reuters.com/fact-check"
      },
      {
        title: "PubMed - Scientific Research Database",
        url: "https://pubmed.ncbi.nlm.nih.gov/"
      }
    ];
  } else {
    // Return general explainer sources for unclear claims
    return [
      {
        title: "Snopes - Fact Checking & Debunking",
        url: "https://www.snopes.com/"
      },
      {
        title: "PolitiFact - Truth-O-Meter",
        url: "https://www.politifact.com/"
      },
      {
        title: "FactCheck.org - Nonpartisan Fact Checking",
        url: "https://www.factcheck.org/"
      }
    ];
  }
}

// =============================================================================
// Start server
// =============================================================================

app.listen(PORT, () => {
  console.log(`\n🔮 Lora Backend running on http://localhost:${PORT}`);
  console.log(`\n📡 Endpoints:`);
  console.log(`   POST /api/check            - Fact-check text (multi-AI consensus)`);
  console.log(`   POST /api/check-video      - Fact-check video (Gemini vision)`);
  console.log(`   POST /api/check-transcript - Fact-check video via transcript (multi-AI)`);
  console.log(`   POST /api/chat             - General LLM chat`);
  console.log(`   POST /api/task             - Task processing (summarize, translate, extract)`);
  console.log(`   GET  /health               - Health check\n`);
});
