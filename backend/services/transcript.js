/**
 * Transcript extraction service
 * Supports YouTube and direct transcript text
 */

// YouTube transcript extraction (no API key needed!)
export async function extractYouTubeTranscript(videoUrl) {
  try {
    // Extract video ID from URL
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) {
      throw new Error('Invalid YouTube URL');
    }

    // Fetch transcript using YouTube's internal API
    const transcript = await fetchYouTubeTranscript(videoId);
    return transcript;

  } catch (err) {
    console.error('[Transcript Error]', err.message || err);
    throw new Error(`Transcript extraction failed: ${err.message || 'Unknown error'}`);
  }
}

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/ // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchYouTubeTranscript(videoId) {
  // First, get the video page to find caption tracks
  const videoPageUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(videoPageUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch video page: ${response.status}`);
  }

  const html = await response.text();

  // Extract caption track URL from the page
  const captionMatch = html.match(/"captions":\s*(\{[^}]+\})/);
  if (!captionMatch) {
    // Try alternative: look for timedtext URL directly
    const timedTextMatch = html.match(/https:\/\/www\.youtube\.com\/api\/timedtext[^"]+/);
    if (timedTextMatch) {
      return await fetchTranscriptFromUrl(timedTextMatch[0].replace(/\\u0026/g, '&'));
    }
    throw new Error('No captions available for this video');
  }

  // Try to find playerCaptionsTracklistRenderer
  const tracklistMatch = html.match(/"playerCaptionsTracklistRenderer":\s*\{[^}]*"captionTracks":\s*\[([^\]]+)\]/);
  if (tracklistMatch) {
    const tracksJson = `[${tracklistMatch[1]}]`;
    try {
      // Clean up the JSON
      const cleanJson = tracksJson.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const baseUrlMatch = cleanJson.match(/"baseUrl":\s*"([^"]+)"/);
      if (baseUrlMatch) {
        const baseUrl = baseUrlMatch[1].replace(/\\u0026/g, '&');
        return await fetchTranscriptFromUrl(baseUrl);
      }
    } catch (e) {
      // Continue to fallback
    }
  }

  // Fallback: Try innertube API
  return await fetchTranscriptViaInnertube(videoId);
}

async function fetchTranscriptFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch transcript');
  }

  const xml = await response.text();
  
  // Parse XML transcript
  const textMatches = xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g);
  const segments = [];

  for (const match of textMatches) {
    const text = match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n/g, ' ')
      .trim();
    
    if (text) {
      segments.push(text);
    }
  }

  if (segments.length === 0) {
    throw new Error('No transcript text found');
  }

  return segments.join(' ');
}

async function fetchTranscriptViaInnertube(videoId) {
  // Use YouTube's innertube API
  const response = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20231219.04.00'
        }
      },
      params: Buffer.from(`\n\x0b${videoId}`).toString('base64')
    })
  });

  if (!response.ok) {
    throw new Error('Innertube API failed');
  }

  const data = await response.json();
  
  // Extract transcript from response
  const transcriptRenderer = data?.actions?.[0]?.updateEngagementPanelAction
    ?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer
    ?.body?.transcriptSegmentListRenderer?.initialSegments;

  if (!transcriptRenderer) {
    throw new Error('Could not parse transcript from API');
  }

  const segments = transcriptRenderer
    .map(seg => seg?.transcriptSegmentRenderer?.snippet?.runs?.[0]?.text)
    .filter(Boolean);

  return segments.join(' ');
}

/**
 * Chunk transcript for analysis (long videos)
 */
export function chunkTranscript(transcript, maxChunkSize = 4000) {
  if (transcript.length <= maxChunkSize) {
    return [transcript];
  }

  const chunks = [];
  const sentences = transcript.split(/(?<=[.!?])\s+/);
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
    }
    currentChunk += sentence + ' ';
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Format transcript for display
 */
export function formatTranscriptPreview(transcript, maxLength = 200) {
  if (transcript.length <= maxLength) {
    return transcript;
  }
  return transcript.substring(0, maxLength) + '...';
}

