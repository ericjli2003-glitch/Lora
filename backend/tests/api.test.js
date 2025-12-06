/**
 * API Endpoint Tests
 * 
 * Tests for all Lora backend API endpoints.
 * Run with: npm test
 * 
 * NOTE: These tests require the server to be running.
 * Start the server first: npm start
 */

import { describe, it, expect, beforeAll } from 'vitest';

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

// Check if server is running
let serverAvailable = false;

async function checkServer() {
  try {
    const response = await fetch(`${BASE_URL}/health`, { 
      signal: AbortSignal.timeout(2000) 
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Helper to make requests
async function api(endpoint, options = {}) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  return {
    status: response.status,
    data: await response.json()
  };
}

// =============================================================================
// SERVER CHECK
// =============================================================================

beforeAll(async () => {
  serverAvailable = await checkServer();
  if (!serverAvailable) {
    console.log('\n⚠️  Server not running - skipping API tests');
    console.log('   Start server with: npm start\n');
  }
});

// =============================================================================
// HEALTH CHECK
// =============================================================================

describe('Health Check', () => {
  it.skipIf(!serverAvailable)('GET /health should return success', async () => {
    const { status, data } = await api('/health');
    
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBeDefined();
  });
});

// =============================================================================
// FACT CHECK ENDPOINT
// =============================================================================

describe('POST /api/check', () => {
  it.skipIf(!serverAvailable)('should return 400 for empty text', async () => {
    const { status, data } = await api('/api/check', {
      method: 'POST',
      body: JSON.stringify({ text: '' })
    });
    
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });
  
  it.skipIf(!serverAvailable)('should return 400 for missing text', async () => {
    const { status, data } = await api('/api/check', {
      method: 'POST',
      body: JSON.stringify({})
    });
    
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });
  
  it.skipIf(!serverAvailable)('should return personal mode for anecdotes', async () => {
    const { status, data } = await api('/api/check', {
      method: 'POST',
      body: JSON.stringify({ text: 'My cat is sleeping on my keyboard right now' })
    });
    
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.mode).toBe('personal');
    expect(data.score).toBeNull();
  });
  
  it.skipIf(!serverAvailable)('should return fact_check mode for factual claims', async () => {
    const { status, data } = await api('/api/check', {
      method: 'POST',
      body: JSON.stringify({ text: 'The Pacific Ocean is the largest ocean on Earth' })
    });
    
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.mode).toBe('fact_check');
    expect(data.score).toBeDefined();
    expect(data.score).toBeGreaterThanOrEqual(0);
    expect(data.score).toBeLessThanOrEqual(100);
    expect(data.loraVerdict).toBeDefined();
    expect(data.loraMessage).toBeDefined();
  }, 60000);
  
  it.skipIf(!serverAvailable)('should include latency information', async () => {
    const { status, data } = await api('/api/check', {
      method: 'POST',
      body: JSON.stringify({ text: 'Cats are mammals' })
    });
    
    expect(status).toBe(200);
    expect(data.latency).toBeDefined();
    expect(data.latency.totalMs).toBeDefined();
  }, 60000);
});

// =============================================================================
// ANALYZE ENDPOINT
// =============================================================================

describe('POST /analyze', () => {
  it.skipIf(!serverAvailable)('should handle single text input', async () => {
    const { status, data } = await api('/analyze', {
      method: 'POST',
      body: JSON.stringify({ input: 'I love programming' })
    });
    
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });
  
  it.skipIf(!serverAvailable)('should handle array of comments', async () => {
    const { status, data } = await api('/analyze', {
      method: 'POST',
      body: JSON.stringify({ 
        input: ['Great product!', 'Terrible service', 'Okay I guess'] 
      })
    });
    
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.mode).toBe('comments');
  }, 30000);
  
  it.skipIf(!serverAvailable)('should return 400 for empty input', async () => {
    const { status, data } = await api('/analyze', {
      method: 'POST',
      body: JSON.stringify({ input: '' })
    });
    
    expect(status).toBe(400);
    expect(data.success).toBe(false);
  });
});

// =============================================================================
// CACHE ENDPOINTS
// =============================================================================

describe('Cache Management', () => {
  it.skipIf(!serverAvailable)('GET /api/cache-stats should return statistics', async () => {
    const { status, data } = await api('/api/cache-stats');
    
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.caches).toBeDefined();
  });
  
  it.skipIf(!serverAvailable)('POST /api/clear-cache should clear caches', async () => {
    const { status, data } = await api('/api/clear-cache', {
      method: 'POST'
    });
    
    expect(status).toBe(200);
    expect(data.success).toBe(true);
  });
});

// =============================================================================
// MOCK TESTS (don't require server)
// =============================================================================

describe('API Response Structure', () => {
  it('should define expected response format', () => {
    // This test documents the expected API response format
    const expectedCheckResponse = {
      success: true,
      mode: 'fact_check',
      claim: 'string',
      score: 0, // 0-100
      confidence: 0.5, // 0-1
      loraVerdict: 'TRUE',
      loraMessage: 'string',
      latency: {
        fastPhaseMs: 0,
        fullPhaseMs: 0,
        totalMs: 0
      },
      usedModels: {
        fast: [],
        mid: [],
        full: []
      },
      sources: [],
      fromCache: false
    };
    
    expect(expectedCheckResponse.success).toBe(true);
    expect(typeof expectedCheckResponse.score).toBe('number');
  });
  
  it('should define personal mode response format', () => {
    const personalResponse = {
      success: true,
      mode: 'personal',
      claim: 'My cat is cute',
      score: null,
      loraVerdict: null,
      loraMessage: 'this feels personal, not something to fact-check'
    };
    
    expect(personalResponse.mode).toBe('personal');
    expect(personalResponse.score).toBeNull();
  });
});
