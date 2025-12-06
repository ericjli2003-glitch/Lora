import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { checkWithOpenAI } from './services/openai.js';
import { checkWithAnthropic } from './services/anthropic.js';
import { checkWithGoogle } from './services/google.js';
import { checkWithPerplexity } from './services/perplexity.js';
import { aggregateVerdicts } from './services/aggregator.js';
import { checkVideoFromURL, checkVideoFromBase64, generateSpokenResponse } from './services/video.js';
import { extractYouTubeTranscript, chunkTranscript, formatTranscriptPreview } from './services/transcript.js';
import { extractFromImage, factCheckImage } from './services/image.js';
import { detectAIImage } from './services/detectAIImage.js';
import { analyzeComments } from './services/analyzeComments.js';
import { interpretScreenshot } from './services/interpretScreenshot.js';
import { personalInterpretation } from './services/personalInterpretation.js';
import { detectIntent, needsFactCheck, isPersonal } from './services/intentDetector.js';
import { extractArticleText, extractClaims } from './services/urlFactCheck.js';
import { 
  detectPersonalStatement, 
  computeTruthfulnessSpectrum, 
  analyzeWithSpectrum,
  getSpectrumMessage,
  getVerdictFromScore 
} from './services/truthfulnessSpectrum.js';
import { 
  ultraSpeedCheck, 
  getCacheStats, 
  clearCaches,
  ULTRA_SPEED_CONFIG 
} from './services/ultraSpeed.js';
import logger from './services/logger.js';

dotenv.config();

const app = express();

// ES module dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Increase payload limit for video uploads (50MB)
app.use(express.json({ limit: '50mb' }));

// Rate limiting - protect API from abuse
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    success: false,
    error: {
      message: 'whoa slow down! too many requests, try again in a minute',
      retryAfter: '1 minute'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to API routes
app.use('/api', limiter);
app.use('/analyze', limiter);
app.use('/interpret', limiter);
app.use('/detect-ai', limiter);
app.use('/analyze-comments', limiter);

// Serve static files (web UI)
app.use(express.static(path.join(__dirname, 'public')));

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
      'wait what do you want me to check? send me the text!',
      { field: 'text', received: typeof text }
    ));
  }

  logger.log(`Checking: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);

  try {
    // Ultra-speed pipeline handles:
    // - Personal statement detection (skips all models)
    // - Exact + semantic cache lookup
    // - FAST → MID → FULL bucket execution
    // - Delta verification (skips slow models when not needed)
    // - Result merging (full models win on conflict)
    
    const result = await ultraSpeedCheck(text);
    
    // Handle personal mode (no fact-checking needed)
    if (result.mode === 'personal') {
      // Get warm interpretation for personal content
      let interpretation = null;
      try {
        interpretation = await personalInterpretation(text);
      } catch (e) {
        // Fallback if interpretation fails
      }
      
      return res.json({
        success: true,
        mode: 'personal',
        claim: text,
        score: null,
        loraVerdict: null,
        loraMessage: interpretation?.reaction || result.loraMessage || "this feels personal, not something to fact-check",
        reason: result.reason,
        interpretation,
        latency: result.latency,
        pipelineInfo: result.pipelineInfo
      });
    }
    
    // Log performance
    const speedup = result.pipelineInfo?.skippedFull ? '⚡ FAST' : 
                    result.pipelineInfo?.skippedMid ? '⚡ MID' : '🎯 FULL';
    logger.log(`Result: ${result.score}% ${result.loraVerdict} (${result.latency.totalMs}ms) ${speedup}`);

    // Use live sources from pipeline, fallback to static sources
    const sources = result.sources?.length > 0 
      ? result.sources 
      : getSources(result.loraVerdict, text);

    res.json({
      success: true,
      mode: result.mode,
      claim: text,
      score: result.score,
      confidence: result.confidence,
      loraVerdict: result.loraVerdict,
      loraMessage: result.loraMessage,
      latency: result.latency,
      usedModels: result.usedModels,
      spectrumBreakdown: result.spectrumBreakdown,
      pipelineInfo: result.pipelineInfo,
      sources,
      sourceProvider: result.sourceProvider,
      fromCache: result.fromCache || false,
      cacheType: result.cacheType
    });

  } catch (error) {
    logger.error('Pipeline error:', error.message);
    res.status(500).json(errorResponse(
      'ok something broke on my end, my bad. try again?',
      { type: error.name, message: error.message }
    ));
  }
});

// =============================================================================
// GET /api/cache-stats - View cache statistics
// =============================================================================

app.get('/api/cache-stats', (req, res) => {
  const stats = getCacheStats();
  res.json({
    success: true,
    caches: stats,
    config: {
      skipMidThreshold: ULTRA_SPEED_CONFIG.SKIP_MID_THRESHOLD,
      skipFullThreshold: ULTRA_SPEED_CONFIG.SKIP_FULL_THRESHOLD,
      timeouts: {
        fast: ULTRA_SPEED_CONFIG.FAST_TIMEOUT,
        mid: ULTRA_SPEED_CONFIG.MID_TIMEOUT,
        full: ULTRA_SPEED_CONFIG.FULL_TIMEOUT
      }
    },
    message: `${stats.exactCache + stats.semanticCache} items cached (${stats.semanticCache} semantic)`
  });
});

// =============================================================================
// POST /api/clear-cache - Clear all caches (admin)
// =============================================================================

app.post('/api/clear-cache', (req, res) => {
  clearCaches();
  logger.log('Caches cleared');
  res.json({
    success: true,
    message: 'all caches cleared'
  });
});

// =============================================================================
// POST /api/check-video - Video fact-checking endpoint (Gemini)
// =============================================================================

app.post('/api/check-video', async (req, res) => {
  const { url, base64, mimeType = 'video/mp4' } = req.body;

  if (!url && !base64) {
    return res.status(400).json(errorResponse(
      'need a video to look at! send me a link or upload it',
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
      'couldn\'t process that video, maybe try a different format?',
      { error: error.message }
    ));
  }
});

// =============================================================================
// POST /api/check-image - Image/Screenshot fact-checking (Gemini)
// =============================================================================

app.post('/api/check-image', async (req, res) => {
  const { base64, mimeType = 'image/png', url } = req.body;

  if (!base64 && !url) {
    return res.status(400).json(errorResponse(
      'send me the image! I can\'t check what I can\'t see',
      { received: { hasBase64: !!base64, hasUrl: !!url } }
    ));
  }

  console.log(`\n🖼️  Analyzing image...`);

  try {
    let imageBase64 = base64;
    let imageMimeType = mimeType;

    // If URL provided, fetch the image
    if (url && !base64) {
      console.log(`   Fetching from URL: ${url.substring(0, 50)}...`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      imageBase64 = Buffer.from(arrayBuffer).toString('base64');
      imageMimeType = response.headers.get('content-type') || 'image/png';
    }

    // Step 1: Extract claims from image
    const extracted = await extractFromImage(imageBase64, imageMimeType);
    console.log(`   Found claims: ${extracted.claims?.length || 0}`);
    console.log(`   Main claim: "${extracted.mainClaim || 'none'}"`);

    // Step 2: If we have a main claim, fact-check it with all AIs
    let loraVerdict = 'UNKNOWN';
    let loraMessage = "not totally sure about this one tbh, getting mixed results";
    let sources = getSources('UNKNOWN', '');

    if (extracted.mainClaim) {
      // Run through multi-AI consensus
      const results = await Promise.allSettled([
        checkWithOpenAI(extracted.mainClaim),
        checkWithAnthropic(extracted.mainClaim),
        checkWithGoogle(extracted.mainClaim),
        checkWithPerplexity(extracted.mainClaim)
      ]);

      const responses = [];
      const models = ['OpenAI', 'Anthropic', 'Google', 'Perplexity'];

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          responses.push({ model: models[index], ...result.value });
          console.log(`   ✅ ${models[index]}: ${result.value.verdict}`);
        } else {
          console.log(`   ❌ ${models[index]}: Failed`);
        }
      });

      if (responses.length > 0) {
        const consensus = aggregateVerdicts(responses);
        
        if (consensus.verdict === 'false') {
          loraVerdict = 'FALSE';
          loraMessage = "looked at your screenshot — yeah that's not true";
        } else if (consensus.verdict === 'true') {
          loraVerdict = 'TRUE';
          loraMessage = "checked your screenshot and yep, that's actually legit!";
        } else {
          loraMessage = "looked at the screenshot but honestly I'm not sure on this one";
        }
        
        sources = getSources(loraVerdict, extracted.mainClaim);
      }
    }

    console.log(`\n🎯 Lora Verdict: ${loraVerdict}`);

    res.json({
      success: true,
      claim: extracted.mainClaim || 'No clear claim found',
      loraVerdict: loraVerdict,
      loraMessage: loraMessage,
      sources: sources,
      imageAnalysis: {
        context: extracted.context,
        allClaims: extracted.claims || []
      }
    });

  } catch (error) {
    console.error('Image analysis error:', error);
    res.status(500).json(errorResponse(
      'couldn\'t read that image for some reason, try again?',
      { error: error.message }
    ));
  }
});

// =============================================================================
// POST /api/check-url - Fact-check a news article URL
// =============================================================================

app.post('/api/check-url', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json(errorResponse(
      'send me a URL and I\'ll check if the article is legit',
      { received: { hasUrl: !!url } }
    ));
  }

  console.log(`\n🔗 Checking URL: ${url.substring(0, 50)}...`);

  try {
    // Step 1: Extract article content
    console.log(`   Extracting article content...`);
    const article = await extractArticleText(url);
    console.log(`   Title: "${article.title}"`);
    console.log(`   Claims found: ${article.claims?.length || 0}`);

    if (!article.claims || article.claims.length === 0) {
      return res.json({
        success: true,
        url: url,
        title: article.title,
        loraVerdict: 'UNKNOWN',
        loraMessage: "couldn't find any specific claims to fact-check in this article",
        claims: []
      });
    }

    // Step 2: Fact-check the main claim
    const mainClaim = article.claims[0];
    console.log(`   Main claim: "${mainClaim.substring(0, 50)}..."`);

    const results = await Promise.allSettled([
      checkWithOpenAI(mainClaim),
      checkWithAnthropic(mainClaim),
      checkWithGoogle(mainClaim),
      checkWithPerplexity(mainClaim)
    ]);

    const responses = [];
    const models = ['OpenAI', 'Anthropic', 'Google', 'Perplexity'];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        responses.push({ model: models[index], ...result.value });
        console.log(`   ✅ ${models[index]}: ${result.value.verdict}`);
      } else {
        console.log(`   ❌ ${models[index]}: Failed`);
      }
    });

    let loraVerdict = 'UNKNOWN';
    let loraMessage = "couldn't verify the claims in this article";

    if (responses.length > 0) {
      const consensus = aggregateVerdicts(responses);
      
      if (consensus.verdict === 'false') {
        loraVerdict = 'FALSE';
        loraMessage = "checked this article and there's some stuff in here that's not true";
      } else if (consensus.verdict === 'true') {
        loraVerdict = 'TRUE';
        loraMessage = "this article checks out, the main claims seem legit";
      } else {
        loraMessage = "mixed results on this one, some claims are hard to verify";
      }
    }

    console.log(`\n🎯 Lora Verdict: ${loraVerdict}`);

    res.json({
      success: true,
      url: url,
      title: article.title,
      mainClaim: mainClaim,
      loraVerdict: loraVerdict,
      loraMessage: loraMessage,
      allClaims: article.claims,
      sources: getSources(loraVerdict, mainClaim)
    });

  } catch (error) {
    console.error('URL check error:', error);
    res.status(500).json(errorResponse(
      'couldn\'t check that URL, maybe try a different link?',
      { error: error.message }
    ));
  }
});

// =============================================================================
// POST /api/detect-ai-image - Detect if an image is AI-generated
// =============================================================================

app.post('/api/detect-ai-image', async (req, res) => {
  const { base64, url } = req.body;

  if (!base64 && !url) {
    return res.status(400).json(errorResponse(
      'need an image to check! send me a link or the image data',
      { received: { hasBase64: !!base64, hasUrl: !!url } }
    ));
  }

  console.log(`\n🎨 Detecting AI-generated image...`);

  try {
    let imageBase64 = base64;

    // If URL provided, fetch the image
    if (url && !base64) {
      console.log(`   Fetching from URL: ${url.substring(0, 50)}...`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      imageBase64 = Buffer.from(arrayBuffer).toString('base64');
    }

    const result = await detectAIImage(imageBase64);
    
    console.log(`   Result: ${result}`);

    let friendlyMessage;
    if (result === 'AI') {
      friendlyMessage = "pretty sure this is AI generated, I can tell by the way it looks";
    } else {
      friendlyMessage = "looks real to me! don't see the usual AI tells";
    }

    res.json({
      success: true,
      result: result,
      isAI: result === 'AI',
      message: friendlyMessage
    });

  } catch (error) {
    console.error('AI detection error:', error);
    res.status(500).json(errorResponse(
      'couldn\'t analyze that one, mind trying again?',
      { error: error.message }
    ));
  }
});

// =============================================================================
// POST /detect-ai - Simplified AI image detection endpoint
// =============================================================================

app.post('/detect-ai', async (req, res) => {
  const { imageBase64 } = req.body;

  if (!imageBase64) {
    return res.status(400).json(errorResponse(
      'send me the image and I\'ll tell you if it\'s AI',
      { received: { hasImageBase64: !!imageBase64 } }
    ));
  }

  console.log(`\n🎨 Quick AI detection check...`);

  try {
    const result = await detectAIImage(imageBase64);
    
    console.log(`   Result: ${result}`);

    let message;
    if (result === 'AI') {
      message = "yeah this looks AI generated to me";
    } else {
      message = "nah this looks like a real photo";
    }

    res.json({
      success: true,
      result: result,
      message: message
    });

  } catch (error) {
    console.error('AI detection error:', error);
    res.status(500).json(errorResponse(
      'couldn\'t check that image, try again?',
      { error: error.message }
    ));
  }
});

// =============================================================================
// POST /analyze-comments - Sentiment analysis for comments
// =============================================================================

app.post('/analyze-comments', async (req, res) => {
  const { comments } = req.body;

  if (!comments || !Array.isArray(comments) || comments.length === 0) {
    return res.status(400).json(errorResponse(
      'send me the comments and I\'ll break them down for you',
      { received: { hasComments: !!comments, isArray: Array.isArray(comments) } }
    ));
  }

  console.log(`\n💬 Analyzing ${comments.length} comments...`);

  try {
    const analysis = await analyzeComments(comments);
    
    console.log(`   Analysis complete!`);
    console.log(`   Overall summary: ${analysis.overallSummary?.substring(0, 50)}...`);

    res.json({
      success: true,
      message: "ok here's what I got from those comments",
      analysis: analysis,
      commentCount: comments.length
    });

  } catch (error) {
    console.error('Comment analysis error:', error);
    res.status(500).json(errorResponse(
      'had trouble with those comments, try again?',
      { error: error.message }
    ));
  }
});

// =============================================================================
// POST /interpret - Smart screenshot/text interpretation
// =============================================================================

app.post('/interpret', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json(errorResponse(
      'paste the text from your screenshot and I\'ll tell you what\'s going on',
      { received: { hasText: !!text, type: typeof text } }
    ));
  }

  console.log(`\n🔮 Interpreting text...`);
  console.log(`   Text preview: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

  try {
    // First, detect the intent
    const intentResult = await detectIntent(text);
    console.log(`   Intent: ${intentResult.intent} (${intentResult.confidence}%)`);

    // Route based on intent
    if (isPersonal(intentResult.intent)) {
      // Personal content — warm interpretation, no fact-checking
      console.log(`   Mode: Personal interpretation`);
      
      const interpretation = await personalInterpretation(text);
      
      console.log(`   Vibe: ${interpretation.vibe}`);
      console.log(`   Emotion: ${interpretation.emotion}`);

      res.json({
        success: true,
        type: 'personal',
        interpretation: interpretation,
        intent: intentResult,
        message: "here's my take on that — this one feels personal"
      });

    } else if (needsFactCheck(intentResult.intent)) {
      // Factual claim — use screenshot interpretation for context analysis
      console.log(`   Mode: Screenshot analysis (factual context)`);
      
      const interpretation = await interpretScreenshot(text);
      
      console.log(`   Tone: ${interpretation.tone}`);
      console.log(`   Conflict: ${interpretation.conflict?.detected ? 'Yes' : 'No'}`);

      res.json({
        success: true,
        type: 'factual',
        interpretation: interpretation,
        intent: intentResult,
        message: "ok here's my read on this"
      });

    } else {
      // Questions, unclear — default to personal interpretation
      console.log(`   Mode: Default to personal`);
      
      const interpretation = await personalInterpretation(text);

      res.json({
        success: true,
        type: intentResult.intent,
        interpretation: interpretation,
        intent: intentResult,
        message: "not totally sure what this is about, but here's my best take"
      });
    }

  } catch (error) {
    console.error('Interpretation error:', error);
    
    // Fallback: try personal interpretation
    try {
      console.log(`   Fallback: trying personal interpretation`);
      const fallbackInterpretation = await personalInterpretation(text);
      
      res.json({
        success: true,
        type: 'personal',
        interpretation: fallbackInterpretation,
        message: "not totally sure what this is about, but here's my best guess"
      });
    } catch (fallbackError) {
      res.status(500).json(errorResponse(
        'couldn\'t figure that one out, try sending it again?',
        { error: error.message }
      ));
    }
  }
});

// =============================================================================
// POST /analyze - Smart auto-detection (post vs comments vs personal)
// =============================================================================

app.post('/analyze', async (req, res) => {
  const { input } = req.body;

  if (!input) {
    return res.status(400).json(errorResponse(
      'send me something to look at — a post or some comments',
      { received: { hasInput: !!input } }
    ));
  }

  console.log(`\n🧠 Smart analysis request...`);

  try {
    // Auto-detect: array = comments, string = needs intent detection
    const isCommentsArray = Array.isArray(input);
    
    if (isCommentsArray) {
      // It's comments — analyze sentiment
      console.log(`   Detected: ${input.length} comments`);
      
      if (input.length === 0) {
        return res.status(400).json(errorResponse(
          'that\'s an empty list, send me actual comments!',
          { received: { type: 'array', length: 0 } }
        ));
      }

      const analysis = await analyzeComments(input);
      
      res.json({
        success: true,
        type: 'comments',
        message: "here's what I got from those comments",
        analysis: analysis,
        commentCount: input.length
      });

    } else if (typeof input === 'string' && input.trim().length > 0) {
      // It's text — detect intent first
      console.log(`   Detected: text input`);
      console.log(`   Text: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}"`);

      // Detect intent using AI
      const intentResult = await detectIntent(input);
      console.log(`   Intent: ${intentResult.intent} (${intentResult.confidence}%)`);

      if (isPersonal(intentResult.intent)) {
        // Personal content — warm interpretation, NO fact-checking
        console.log(`   Mode: Personal interpretation`);
        
        const interpretation = await personalInterpretation(input);
        
        res.json({
          success: true,
          type: 'personal',
          message: interpretation.reaction,
          interpretation: interpretation,
          intent: intentResult
        });

      } else if (needsFactCheck(intentResult.intent)) {
        // Factual claim — use ULTRA-SPEED pipeline
        logger.log(`Analyze: Ultra-Speed fact-check`);

        const result = await ultraSpeedCheck(input);

        logger.log(`Result: ${result.score}% (${result.latency?.totalMs}ms)`);

        res.json({
          success: true,
          mode: 'fact_check',
          type: 'factual',
          message: result.loraMessage,
          claim: input,
          score: result.score,
          confidence: result.confidence,
          loraVerdict: result.loraVerdict,
          latency: result.latency,
          usedModels: result.usedModels,
          spectrumBreakdown: result.spectrumBreakdown,
          pipelineInfo: result.pipelineInfo,
          sources: getSources(result.loraVerdict, input),
          intent: intentResult,
          fromCache: result.fromCache || false
        });

      } else {
        // Questions or unclear — personal interpretation
        console.log(`   Mode: Default personal interpretation`);
        
        const interpretation = await personalInterpretation(input);
        
        res.json({
          success: true,
          type: intentResult.intent,
          message: interpretation.reaction,
          interpretation: interpretation,
          intent: intentResult
        });
      }

    } else {
      return res.status(400).json(errorResponse(
        'not sure what to do with that — send me text or a list of comments',
        { received: { type: typeof input } }
      ));
    }

  } catch (error) {
    console.error('Smart analysis error:', error);
    
    // Fallback to personal interpretation
    if (typeof input === 'string') {
      try {
        const fallback = await personalInterpretation(input);
        res.json({
          success: true,
          type: 'personal',
          message: "not totally sure what this is, but here's my take",
          interpretation: fallback
        });
        return;
      } catch (e) {
        // Continue to error response
      }
    }
    
    res.status(500).json(errorResponse(
      'something broke, try again?',
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
      'send me a youtube link or paste the transcript',
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
        'couldn\'t process that transcript, try again?',
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
      'had trouble with that transcript, try again?',
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
      'what do you wanna talk about? send me something',
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
          'don\'t know that model, try openai, anthropic, or google',
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
      'brain fart, try that again',
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
      'what do you need? summarize, translate, or extract',
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
          'don\'t know that task — try summarize, translate, or extract',
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
      'that didn\'t work, try again?',
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
  console.log(`\n🌐 Web UI: http://localhost:${PORT}`);
  console.log(`\n📡 API Endpoints:`);
  console.log(`   POST /api/check            - Fact-check text (multi-AI consensus)`);
  console.log(`   POST /api/check-image      - Fact-check image/screenshot (Gemini + multi-AI)`);
  console.log(`   POST /api/check-url        - Fact-check news article URL`);
  console.log(`   POST /api/check-video      - Fact-check video (Gemini vision)`);
  console.log(`   POST /api/check-transcript - Fact-check video via transcript (multi-AI)`);
  console.log(`   POST /api/detect-ai-image  - Detect if image is AI-generated`);
  console.log(`   POST /detect-ai            - Quick AI image detection`);
  console.log(`   POST /analyze-comments     - Analyze comment sentiment & topics`);
  console.log(`   POST /interpret            - Smart text interpretation (auto-detects personal vs factual)`);
  console.log(`   POST /analyze              - Smart auto-detect (personal vs factual vs comments)`);
  console.log(`   POST /api/chat             - General LLM chat`);
  console.log(`   POST /api/task             - Task processing (summarize, translate, extract)`);
  console.log(`   GET  /health               - Health check`);
  console.log(`\n✨ All done! Let me know if you want to analyze something else.\n`);
});
