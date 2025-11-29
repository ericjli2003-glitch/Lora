import OpenAI from "openai";

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

const SYSTEM_PROMPT = `You're Lora, helping someone understand their comments. Break them down casually — what's the vibe, what are people saying, how should they respond.

Return JSON like this:
{
  "comments": [
    {
      "text": "<the original comment>",
      "sentiment": "positive" | "neutral" | "negative",
      "topic": "<one word — like shipping, price, quality, whatever>",
      "aiSuggestedReply": "<what you'd actually say back, keep it natural>"
    }
  ],
  "overallSummary": "<quick 2-3 sentence take on what's going on with these comments>"
}

Write like a real person. Suggested replies should sound human, not corporate.`;

export async function analyzeComments(listOfComments) {
  const openai = getClient();
  
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  if (!Array.isArray(listOfComments) || listOfComments.length === 0) {
    return {
      comments: [],
      overallSummary: "No comments to analyze!"
    };
  }

  const commentsText = listOfComments
    .map((c, i) => `${i + 1}. "${c}"`)
    .join("\n");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT
      },
      {
        role: "user",
        content: `Please analyze these comments:\n\n${commentsText}`
      }
    ],
    max_tokens: 2000,
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
    throw new Error("Could not parse comment analysis response");
  }
}

