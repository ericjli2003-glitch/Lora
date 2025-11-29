import OpenAI from "openai";

let client = null;

function getClient() {
  if (!client && process.env.OPENAI_API_KEY) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export async function detectAIImage(base64Image) {
  const openai = getClient();
  
  if (!openai) {
    throw new Error("OpenAI API key not configured");
  }

  const imageUrl = base64Image.startsWith("data:")
    ? base64Image
    : `data:image/jpeg;base64,${base64Image}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Is this image AI-generated or real? Respond ONLY with 'AI' or 'REAL'."
          },
          {
            type: "image_url",
            image_url: { url: imageUrl }
          }
        ]
      }
    ],
    max_tokens: 10
  });

  const answer = response.choices[0]?.message?.content?.trim().toUpperCase();
  
  if (answer?.includes("AI")) {
    return "AI";
  }
  return "REAL";
}

