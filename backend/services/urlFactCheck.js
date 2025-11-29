import OpenAI from "openai";

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

/**
 * Extract article text from a URL using OpenAI
 */
export async function extractArticleText(url) {
  const openai = getClient();
  
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  // Fetch the URL content
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; LoraBot/1.0)'
    }
  });

  if (!response.ok) {
    throw new Error(`couldn't fetch that URL (${response.status})`);
  }

  const html = await response.text();
  
  // Use GPT to extract the main article text
  const extraction = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Extract the main article content from this HTML. Return JSON:
{
  "title": "<article title>",
  "text": "<main article text, cleaned up>",
  "claims": ["<list of specific factual claims made in the article>"]
}

Focus on factual claims that can be verified. Ignore ads, navigation, comments.`
      },
      {
        role: "user",
        content: html.substring(0, 50000) // Limit HTML size
      }
    ],
    max_tokens: 2000,
    response_format: { type: "json_object" }
  });

  const content = extraction.choices[0]?.message?.content;
  if (!content) {
    throw new Error("couldn't extract article content");
  }

  return JSON.parse(content);
}

/**
 * Get key claims from article text
 */
export async function extractClaims(articleText) {
  const openai = getClient();
  
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Extract the key factual claims from this article that can be fact-checked. Return JSON:
{
  "claims": [
    {
      "claim": "<the specific claim>",
      "importance": "high" | "medium" | "low"
    }
  ],
  "mainClaim": "<the most important claim to verify>"
}

Focus on verifiable statements, statistics, quotes, and factual assertions.`
      },
      {
        role: "user",
        content: articleText
      }
    ],
    max_tokens: 1000,
    response_format: { type: "json_object" }
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("couldn't extract claims");
  }

  return JSON.parse(content);
}

