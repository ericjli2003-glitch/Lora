/**
 * Lightweight Logger
 * 
 * Fast, minimal logging with optional debug mode.
 * Controlled via LORA_DEBUG environment variable.
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const DEBUG = process.env.LORA_DEBUG === 'true';
const TIMING = process.env.LORA_TIMING === 'true' || DEBUG;

// Color codes for terminal
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

// =============================================================================
// LOGGING FUNCTIONS
// =============================================================================

/**
 * Standard info log (always shown)
 */
export function log(message, ...args) {
  console.log(`${COLORS.cyan}[Lora]${COLORS.reset} ${message}`, ...args);
}

/**
 * Debug log (only in debug mode)
 */
export function debug(message, ...args) {
  if (DEBUG) {
    console.log(`${COLORS.dim}[DEBUG]${COLORS.reset} ${message}`, ...args);
  }
}

/**
 * Success log
 */
export function success(message, ...args) {
  console.log(`${COLORS.green}✓${COLORS.reset} ${message}`, ...args);
}

/**
 * Warning log
 */
export function warn(message, ...args) {
  console.log(`${COLORS.yellow}⚠${COLORS.reset} ${message}`, ...args);
}

/**
 * Error log (always shown)
 */
export function error(message, ...args) {
  console.error(`${COLORS.red}✗${COLORS.reset} ${message}`, ...args);
}

/**
 * Timing log (only in timing/debug mode)
 */
export function timing(label, ms) {
  if (TIMING) {
    const color = ms < 500 ? COLORS.green : ms < 2000 ? COLORS.yellow : COLORS.red;
    console.log(`${COLORS.dim}[TIMING]${COLORS.reset} ${label}: ${color}${ms}ms${COLORS.reset}`);
  }
}

// =============================================================================
// TIMING UTILITIES
// =============================================================================

/**
 * Create a timer for measuring execution time
 */
export function createTimer(label) {
  const start = performance.now();
  
  return {
    label,
    start,
    
    /**
     * Get elapsed time without logging
     */
    elapsed() {
      return Math.round(performance.now() - start);
    },
    
    /**
     * Log elapsed time and return it
     */
    end() {
      const elapsed = this.elapsed();
      timing(label, elapsed);
      return elapsed;
    },
    
    /**
     * Log a checkpoint without stopping
     */
    checkpoint(checkpointLabel) {
      const elapsed = this.elapsed();
      timing(`${label} → ${checkpointLabel}`, elapsed);
      return elapsed;
    }
  };
}

/**
 * Wrap an async function with automatic timing
 */
export function withTiming(fn, label) {
  return async (...args) => {
    const timer = createTimer(label);
    try {
      const result = await fn(...args);
      timer.end();
      return result;
    } catch (err) {
      timer.end();
      throw err;
    }
  };
}

// =============================================================================
// STRUCTURED LOGGING
// =============================================================================

/**
 * Log pipeline progress
 */
export function pipeline(phase, status, details = {}) {
  const emoji = {
    start: '🚀',
    cache: '⚡',
    fast: '🏃',
    mid: '🔄',
    full: '🎯',
    done: '✅',
    skip: '⏭️',
    error: '❌'
  }[status] || '📝';
  
  const detailStr = Object.entries(details)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  
  log(`${emoji} ${phase} ${detailStr}`);
}

/**
 * Log model result
 */
export function modelResult(model, verdict, confidence, latency) {
  const icon = verdict?.toLowerCase().includes('true') ? '✓' :
               verdict?.toLowerCase().includes('false') ? '✗' : '?';
  const color = verdict?.toLowerCase().includes('true') ? COLORS.green :
                verdict?.toLowerCase().includes('false') ? COLORS.red : COLORS.yellow;
  
  debug(`  ${color}${icon}${COLORS.reset} ${model}: ${verdict} (${confidence}%) [${latency}ms]`);
}

// =============================================================================
// EXPORT LOGGER OBJECT
// =============================================================================

export default {
  log,
  debug,
  success,
  warn,
  error,
  timing,
  createTimer,
  withTiming,
  pipeline,
  modelResult
};

