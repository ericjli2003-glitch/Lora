/**
 * HTTP Agent Manager
 * 
 * Provides keep-alive HTTP agents for all outbound API calls.
 * Enables TCP connection reuse for faster subsequent requests.
 */

import http from 'http';
import https from 'https';

// =============================================================================
// KEEP-ALIVE AGENTS
// =============================================================================

/**
 * HTTPS agent with keep-alive for API calls
 * Reuses TCP connections to reduce latency
 */
export const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,  // Keep connections alive for 30s
  maxSockets: 50,         // Max concurrent connections
  maxFreeSockets: 10,     // Keep 10 idle connections ready
  timeout: 30000,         // 30s socket timeout
  scheduling: 'fifo'      // First-in-first-out for fair distribution
});

/**
 * HTTP agent (for local development)
 */
export const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 30000
});

// =============================================================================
// AGENT STATS
// =============================================================================

export function getAgentStats() {
  return {
    https: {
      sockets: Object.keys(httpsAgent.sockets).length,
      freeSockets: Object.keys(httpsAgent.freeSockets).length,
      requests: Object.keys(httpsAgent.requests).length
    },
    http: {
      sockets: Object.keys(httpAgent.sockets).length,
      freeSockets: Object.keys(httpAgent.freeSockets).length,
      requests: Object.keys(httpAgent.requests).length
    }
  };
}

// =============================================================================
// FETCH WITH AGENT
// =============================================================================

/**
 * Enhanced fetch that uses keep-alive agents
 * Drop-in replacement for fetch with better performance
 */
export async function fetchWithAgent(url, options = {}) {
  const isHttps = url.startsWith('https');
  
  const fetchOptions = {
    ...options,
    agent: isHttps ? httpsAgent : httpAgent
  };
  
  // Note: Node.js native fetch doesn't support agent directly
  // This is for use with node-fetch or similar libraries
  return fetch(url, fetchOptions);
}

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Destroy all agents (for graceful shutdown)
 */
export function destroyAgents() {
  httpsAgent.destroy();
  httpAgent.destroy();
}

// Clean up on process exit
process.on('exit', destroyAgents);
process.on('SIGINT', () => {
  destroyAgents();
  process.exit(0);
});

