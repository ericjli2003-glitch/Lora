/**
 * Ultra-Speed Pipeline Tests
 * 
 * Comprehensive test suite for the Lora fact-checking pipeline.
 * Run with: npm test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { detectPersonalStatement, computeTruthfulnessSpectrum } from '../services/truthfulnessSpectrum.js';
import { quickClean, extractMainClaim, compressForInference } from '../services/inputCompressor.js';
import { checkExactCache, cacheResult, clearAllCaches } from '../services/semanticCache.js';

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

// Skip integration tests if no API keys
const hasAPIKeys = process.env.OPENAI_API_KEY && process.env.GOOGLE_API_KEY;

// =============================================================================
// PERSONAL STATEMENT DETECTION TESTS
// =============================================================================

describe('Personal Statement Detection', () => {
  it('should detect first-person anecdotes', () => {
    const cases = [
      { text: 'My girlfriend bought me a cheese ball today', expected: true },
      { text: 'I went to the store and saw something funny', expected: true },
      { text: 'My mom always says this to me', expected: true },
      { text: 'Today I learned something new', expected: true },
      { text: 'I feel like this is going to be a great day', expected: true }
    ];
    
    for (const { text, expected } of cases) {
      const result = detectPersonalStatement(text);
      expect(result.isPersonal, `"${text}" should be personal=${expected}`).toBe(expected);
    }
  });
  
  it('should detect emotional statements', () => {
    const cases = [
      { text: "I'm so happy right now!", expected: true },
      { text: 'This made my day', expected: true },
      { text: "I'm feeling sad today", expected: true },
      { text: 'LOL this is hilarious', expected: true }
    ];
    
    for (const { text, expected } of cases) {
      const result = detectPersonalStatement(text);
      expect(result.isPersonal, `"${text}" should be personal=${expected}`).toBe(expected);
    }
  });
  
  it('should NOT flag factual claims as personal', () => {
    const cases = [
      'The Earth is approximately 4.5 billion years old',
      'Scientists discovered a new species in the Amazon',
      'The vaccine has been tested on 40,000 participants',
      'COVID-19 was first reported in Wuhan, China',
      'The unemployment rate dropped to 3.5%'
    ];
    
    for (const text of cases) {
      const result = detectPersonalStatement(text);
      expect(result.isPersonal, `"${text}" should NOT be personal`).toBe(false);
    }
  });
  
  it('should handle edge cases', () => {
    // Empty or very short
    expect(detectPersonalStatement('').isPersonal).toBe(true);
    expect(detectPersonalStatement('lol').isPersonal).toBe(true);
    
    // Short factual claims should NOT be personal if they're substantive
    const shortFact = detectPersonalStatement('Water is H2O');
    // This is short but is a factual claim - behavior may vary
  });
});

// =============================================================================
// TRUTHFULNESS SPECTRUM TESTS
// =============================================================================

describe('Truthfulness Spectrum Calculation', () => {
  it('should compute correct score for all TRUE verdicts', () => {
    const responses = [
      { verdict: 'TRUE', confidence: 90 },
      { verdict: 'TRUE', confidence: 85 },
      { verdict: 'TRUE', confidence: 95 }
    ];
    
    const result = computeTruthfulnessSpectrum(responses);
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.score).toBeLessThanOrEqual(100);
  });
  
  it('should compute correct score for all FALSE verdicts', () => {
    const responses = [
      { verdict: 'FALSE', confidence: 90 },
      { verdict: 'FALSE', confidence: 85 },
      { verdict: 'FALSE', confidence: 95 }
    ];
    
    const result = computeTruthfulnessSpectrum(responses);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(15);
  });
  
  it('should compute mixed score for disagreeing verdicts', () => {
    const responses = [
      { verdict: 'TRUE', confidence: 80 },
      { verdict: 'FALSE', confidence: 80 },
      { verdict: 'MIXED', confidence: 70 }
    ];
    
    const result = computeTruthfulnessSpectrum(responses);
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.score).toBeLessThanOrEqual(70);
  });
  
  it('should handle unverifiable verdicts', () => {
    const responses = [
      { verdict: 'UNVERIFIABLE', confidence: 50 },
      { verdict: 'UNVERIFIABLE', confidence: 60 }
    ];
    
    const result = computeTruthfulnessSpectrum(responses);
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.score).toBeLessThanOrEqual(50);
  });
  
  it('should handle empty responses', () => {
    const result = computeTruthfulnessSpectrum([]);
    expect(result.score).toBe(null);
  });
  
  it('should weight by confidence', () => {
    // High confidence TRUE + low confidence FALSE should lean TRUE
    const responses = [
      { verdict: 'TRUE', confidence: 95 },
      { verdict: 'FALSE', confidence: 30 }
    ];
    
    const result = computeTruthfulnessSpectrum(responses);
    expect(result.score).toBeGreaterThan(50);
  });
});

// =============================================================================
// INPUT COMPRESSION TESTS
// =============================================================================

describe('Input Compression', () => {
  describe('quickClean', () => {
    it('should remove excessive whitespace', () => {
      expect(quickClean('hello    world')).toBe('hello world');
      expect(quickClean('  trim  me  ')).toBe('trim me');
    });
    
    it('should remove emoji and collapse spaces', () => {
      const result = quickClean('hello 👋 world 🌍');
      expect(result).toBe('hello world');
    });
    
    it('should remove repeated punctuation', () => {
      expect(quickClean('what???')).toBe('what?');
      expect(quickClean('wow!!!')).toBe('wow!');
    });
    
    it('should remove filler words', () => {
      const cleaned = quickClean('basically it was um literally amazing');
      expect(cleaned).not.toContain('basically');
      expect(cleaned).not.toContain('um');
      expect(cleaned).not.toContain('literally');
    });
    
    it('should handle empty input', () => {
      expect(quickClean('')).toBe('');
      expect(quickClean(null)).toBe('');
      expect(quickClean(undefined)).toBe('');
    });
  });
  
  describe('extractMainClaim', () => {
    it('should extract the main claim from text', () => {
      const text = 'Hey so I was reading this article. It said the Earth is flat. Pretty crazy right?';
      const claim = extractMainClaim(text);
      
      expect(claim).toBeTruthy();
      expect(claim.length).toBeGreaterThan(10);
    });
    
    it('should prefer sentences with claim indicators', () => {
      const text = 'Wow amazing. The study found that coffee reduces heart disease. So cool!';
      const claim = extractMainClaim(text);
      
      expect(claim.toLowerCase()).toContain('study');
    });
    
    it('should handle single sentence', () => {
      const text = 'The vaccine is 95% effective.';
      const claim = extractMainClaim(text);
      
      expect(claim).toBe('The vaccine is 95% effective');
    });
  });
  
  describe('compressForInference', () => {
    it('should return short text unchanged', async () => {
      const short = 'The Earth is round.';
      const result = await compressForInference(short);
      
      expect(result.compressed.length).toBeLessThanOrEqual(short.length + 10);
      expect(result.method).toBe('local');
    });
    
    it('should compress long text', async () => {
      const long = 'A'.repeat(1000);
      const result = await compressForInference(long, { maxLength: 200 });
      
      expect(result.compressed.length).toBeLessThanOrEqual(200);
    });
    
    it('should preserve semantic meaning', async () => {
      const text = 'Scientists have discovered that drinking coffee every day can reduce the risk of heart disease by up to 15 percent according to a new study.';
      const result = await compressForInference(text);
      
      // Should still contain key information
      expect(result.compressed.toLowerCase()).toMatch(/coffee|heart|study/);
    });
  });
});

// =============================================================================
// CACHE TESTS
// =============================================================================

describe('Caching', () => {
  beforeAll(() => {
    clearAllCaches();
  });
  
  afterAll(() => {
    clearAllCaches();
  });
  
  describe('Exact Cache', () => {
    it('should return miss for uncached text', () => {
      const result = checkExactCache('completely new unique text ' + Date.now());
      expect(result.hit).toBe(false);
    });
    
    it('should return hit after caching', async () => {
      const text = 'cached test text ' + Date.now();
      const data = { score: 85, verdict: 'TRUE' };
      
      await cacheResult(text, data);
      
      const result = checkExactCache(text);
      expect(result.hit).toBe(true);
      expect(result.data).toEqual(data);
    });
    
    it('should normalize text for caching', async () => {
      const uniqueId = Date.now();
      const text1 = `  Hello World ${uniqueId}  `;
      const text2 = `hello world ${uniqueId}`;
      const data = { score: 90, verdict: 'TRUE' };
      
      await cacheResult(text1, data);
      
      const result = checkExactCache(text2);
      expect(result.hit).toBe(true);
    });
  });
});

// =============================================================================
// PERFORMANCE TESTS
// =============================================================================

describe('Performance', () => {
  it('should process personal statements quickly', () => {
    const start = performance.now();
    detectPersonalStatement('I love pizza');
    const elapsed = performance.now() - start;
    
    expect(elapsed).toBeLessThan(10); // Should be < 10ms
  });
  
  it('should return cached results quickly', async () => {
    const text = 'Performance test cached query ' + Date.now();
    
    // Prime the cache
    await cacheResult(text, { score: 85, cached: true });
    
    const start = performance.now();
    const result = checkExactCache(text);
    const elapsed = performance.now() - start;
    
    expect(result.hit).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
  
  it('should quick-clean in <1ms', () => {
    const text = 'This is a test with emoji 👋 and extra   spaces!!!';
    
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      quickClean(text);
    }
    const elapsed = (performance.now() - start) / 100;
    
    expect(elapsed).toBeLessThan(1);
  });
});
