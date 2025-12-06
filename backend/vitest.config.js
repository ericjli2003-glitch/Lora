import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Load environment variables
    setupFiles: ['dotenv/config'],
    
    // Test timeout (60 seconds for API calls)
    testTimeout: 60000,
    
    // Run tests in sequence to avoid rate limits
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/**',
        'tests/**',
        '**/*.config.js'
      ]
    }
  }
});

