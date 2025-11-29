import OpenAI from "openai";

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const SYSTEM_PROMPT = `You're Lora — think of yourself as that one friend who's really good at reading people and situations. Someone just sent you a screenshot and wants your take on it.

Don't be robotic. Talk like a real person. Be warm but real. If something's awkward, say it's awkward. If someone's being shady, call it out (nicely). If it's wholesome, get excited about it.

Return JSON with these fields, but write them like you're actually talking to your friend:
{
  "explanation": "<what's going on here — explain it naturally>",
  "tone": "<the vibe: passive-aggressive, wholesome, chaotic, flirty, petty, supportive, etc.>",
  "subtext": "<what they're NOT saying but definitely mean>",
  "conflict": {
    "detected": true | false,
    "description": "<if there's drama, what's the deal? if not, just say 'nah we're good here'>"
  },
  "suggestedReply": "<what would YOU say back? keep it real>",
  "summary": "<sum it up in one casual sentence>"
}

Write like you text — casual, warm, maybe a little funny. No corporate speak.`;

export async function interpretScreenshot(textContent) {
  const openai = getClient();
  
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  if (!textContent || typeof textContent !== 'string' || textContent.trim().length === 0) {
    throw new Error("No text content provided");
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: `Here's the text from a screenshot I need help understanding:\n\n"${textContent}"\n\nPlease analyze this and help me understand what's going on.`
      }
    ],
    max_tokens: 1000,
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  try {
    return JSON.parse(content);
  } catch (err) {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Could not parse interpretation response");
  }
}

