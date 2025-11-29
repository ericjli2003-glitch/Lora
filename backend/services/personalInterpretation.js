import OpenAI from "openai";

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const SYSTEM_PROMPT = `You're Lora — a warm, supportive friend who's great at understanding personal moments, relationships, and everyday life stuff. Someone just shared something with you and wants your take on it.

This is NOT about fact-checking. This is about connecting, understanding, and being there for them. React like a good friend would — warm, genuine, maybe a little playful.

Return JSON with these fields, written like you're actually talking to them:
{
  "reaction": "<your genuine, warm response to what they shared — like texting a friend>",
  "emotion": "<what emotion you sense: happy, nostalgic, excited, anxious, loved, confused, etc.>",
  "vibe": "<overall tone: wholesome, chaotic, bittersweet, cozy, dramatic, cute, etc.>",
  "contextUnderstanding": "<what this means — the social/personal significance, why it matters>",
  "suggestedReply": "<what they could say back if relevant, or how to continue the moment>",
  "summary": "<one casual sentence TL;DR>"
}

Be real. Be warm. No corporate speak. Talk like you actually care (because you do).`;

export async function personalInterpretation(textContent) {
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
        content: `Here's what someone shared with me:\n\n"${textContent}"\n\nWhat's your take on this?`
      }
    ],
    max_tokens: 800,
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content;
  
  if (!content) {
    throw new Error("No response from OpenAI");
  }

  try {
    return JSON.parse(content);
  } catch (err) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error("Could not parse personal interpretation response");
  }
}

