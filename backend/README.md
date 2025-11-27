# Lora Backend

Multi-AI fact-checking backend that queries OpenAI, Claude, Gemini, and Perplexity to provide consensus-based verdicts.

## Setup

1. **Install dependencies:**
   ```bash
   cd backend
   npm install
   ```

2. **Configure API keys:**
   ```bash
   cp env.example.txt .env
   ```
   
   Edit `.env` and add your API keys:
   - `OPENAI_API_KEY` - Get from [OpenAI Platform](https://platform.openai.com)
   - `ANTHROPIC_API_KEY` - Get from [Anthropic Console](https://console.anthropic.com)
   - `GOOGLE_API_KEY` - Get from [Google AI Studio](https://makersuite.google.com)
   - `PERPLEXITY_API_KEY` - Get from [Perplexity](https://www.perplexity.ai)

3. **Run the server:**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

## API Endpoints

### POST /api/check
Fact-check a claim using multiple AI models.

**Request:**
```json
{
  "text": "The Earth is flat"
}
```

**Response:**
```json
{
  "verdict": "false",
  "confidence": 95,
  "summary": "FALSE (95% confidence, 4 models). The Earth is an oblate spheroid...",
  "spokenResponse": "This appears to be false with 95% confidence. The Earth is an oblate spheroid...",
  "details": {
    "modelsQueried": 4,
    "modelsResponded": 4,
    "responses": [...]
  }
}
```

### GET /health
Health check endpoint.

## Architecture

```
/api/check
    │
    ├── OpenAI (gpt-4o-mini)
    ├── Claude (claude-sonnet-4-20250514)
    ├── Gemini (gemini-1.5-flash)
    └── Perplexity (llama-3.1-sonar-small-128k-online)
    │
    └── Aggregator → Consensus Verdict
```

The aggregator uses confidence-weighted voting to determine the final verdict.

## Verdicts

- `true` - Claim is accurate
- `false` - Claim is inaccurate
- `partially_true` - Contains some truth but is misleading
- `unverifiable` - Cannot be verified with available information

