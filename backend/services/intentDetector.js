import OpenAI from "openai";

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const SYSTEM_PROMPT = `You classify text into one of these categories. Be quick and accurate.

Categories:
- "factual_claim" = statements claiming something is true/false that can be verified (news, statistics, scientific claims, quotes, historical facts, misinformation)
- "personal" = personal stories, anecdotes, relationship stuff, emotions, everyday life moments, casual updates about someone's life
- "question" = asking for information or advice
- "opinion" = subjective takes, preferences, reviews
- "story" = narratives, longer personal accounts, venting

Return ONLY valid JSON:
{
  "intent": "<one of: factual_claim, personal, question, opinion, story>",
  "confidence": <0-100>,
  "reason": "<one short sentence why>"
}

Examples:
- "The moon landing was faked" → factual_claim (verifiable claim about history)
- "My girlfriend bought me a cheese ball" → personal (everyday life moment)
- "Is the Earth round?" → question (asking for info)
- "I think pizza is overrated" → opinion (subjective preference)
- "So basically my ex texted me and it was so awkward..." → story (personal narrative)

When in doubt between factual_claim and personal, lean toward personal if it sounds like someone sharing their life rather than stating a fact about the world.`;

export async function detectIntent(textContent) {
  const openai = getClient();
  
  if (!openai) {
    // Fallback to simple heuristics if no API key
    return fallbackDetection(textContent);
  }

  if (!textContent || typeof textContent !== 'string' || textContent.trim().length === 0) {
    return { intent: 'personal', confidence: 50, reason: 'empty or invalid input' };
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini", // Using mini for speed and cost
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: textContent
        }
      ],
      max_tokens: 100,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      return fallbackDetection(textContent);
    }

    try {
      return JSON.parse(content);
    } catch {
      return fallbackDetection(textContent);
    }

  } catch (err) {
    console.error('[Intent Detection Error]', err.message);
    return fallbackDetection(textContent);
  }
}

// Simple fallback if LLM unavailable
function fallbackDetection(text) {
  const lower = text.toLowerCase();
  
  // Check for question patterns
  if (lower.includes('?') || lower.startsWith('is ') || lower.startsWith('are ') || 
      lower.startsWith('what ') || lower.startsWith('how ') || lower.startsWith('why ')) {
    return { intent: 'question', confidence: 60, reason: 'question pattern detected' };
  }
  
  // Check for personal indicators
  const personalIndicators = ['my ', 'i ', "i'm", 'me ', 'we ', 'our ', 'boyfriend', 'girlfriend', 
    'friend', 'mom', 'dad', 'family', 'bought me', 'told me', 'gave me', 'feels like', 
    'i feel', 'i think', 'just happened', 'today i', 'yesterday'];
  
  for (const indicator of personalIndicators) {
    if (lower.includes(indicator)) {
      return { intent: 'personal', confidence: 70, reason: 'personal language detected' };
    }
  }
  
  // Check for factual claim patterns
  const factualIndicators = ['study shows', 'research', 'percent', '%', 'according to', 
    'scientists', 'proven', 'fact', 'actually', 'true that', 'is fake', 'is real',
    'never happened', 'did happen', 'was faked'];
  
  for (const indicator of factualIndicators) {
    if (lower.includes(indicator)) {
      return { intent: 'factual_claim', confidence: 70, reason: 'factual language detected' };
    }
  }
  
  // Default to personal (safer, friendlier)
  return { intent: 'personal', confidence: 50, reason: 'defaulting to personal interpretation' };
}

// Quick check if something needs fact-checking
export function needsFactCheck(intent) {
  return intent === 'factual_claim';
}

// Quick check if something is personal/emotional
export function isPersonal(intent) {
  return ['personal', 'story', 'opinion'].includes(intent);
}

