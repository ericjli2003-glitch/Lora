/**
 * LORA — Dynamic Response Generator
 * 
 * Generates ALL user-facing messages via LLM.
 * NO HARDCODED RESPONSES.
 */

let openaiClient = null;

async function getOpenAI() {
  if (!openaiClient) {
    const { default: OpenAI } = await import('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Generate a response for any Lora analysis result
 * @param {Object} context - Analysis context
 * @returns {Promise<Object>} Generated responses
 */
export async function generateResponse(context) {
  const openai = await getOpenAI();
  
  const prompt = `You are Lora, a warm and helpful AI assistant. Generate natural, friendly responses based on this analysis context.

CONTEXT:
${JSON.stringify(context, null, 2)}

Generate a JSON response with:
1. "loraMessage" - A friendly, conversational message summarizing the results
2. "siriResponse" - A SHORT (1-2 sentences) spoken response for voice assistants
3. "detailedMessage" - A more detailed explanation if needed (or null)

RULES:
- Be warm, friendly, conversational
- Reference specific findings when relevant
- If harmful content, prioritize warning
- siriResponse must be speakable (no emoji, short)
- Don't be robotic or templated
- Vary your responses naturally

Respond in JSON only.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are Lora, a warm AI. Generate natural responses. JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('[ResponseGenerator] Error:', error.message);
    return {
      loraMessage: null,
      siriResponse: null,
      detailedMessage: null,
      generationFailed: true
    };
  }
}

/**
 * Generate response for image analysis
 */
export async function generateImageResponse(imageAnalysis) {
  return generateResponse({
    type: 'image_analysis',
    ...imageAnalysis
  });
}

/**
 * Generate response for URL/article analysis
 */
export async function generateUrlResponse(urlAnalysis) {
  return generateResponse({
    type: 'url_analysis',
    ...urlAnalysis
  });
}

/**
 * Generate response for video analysis
 */
export async function generateVideoResponse(videoAnalysis) {
  return generateResponse({
    type: 'video_analysis',
    ...videoAnalysis
  });
}

/**
 * Generate response for comment analysis
 */
export async function generateCommentResponse(commentAnalysis) {
  return generateResponse({
    type: 'comment_analysis',
    ...commentAnalysis
  });
}

/**
 * Generate response for personal/interpretation mode
 */
export async function generatePersonalResponse(interpretation) {
  return generateResponse({
    type: 'personal_interpretation',
    ...interpretation
  });
}

/**
 * Generate response for fact-check results
 */
export async function generateFactCheckResponse(factCheckResult) {
  return generateResponse({
    type: 'fact_check',
    ...factCheckResult
  });
}

export default {
  generateResponse,
  generateImageResponse,
  generateUrlResponse,
  generateVideoResponse,
  generateCommentResponse,
  generatePersonalResponse,
  generateFactCheckResponse
};

