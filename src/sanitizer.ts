/**
 * Sensitive Information Filter (Smart Replacement)
 * Sanitizes prompts before sending to iFlow API
 * Uses natural replacements to reduce fingerprinting
 */

// Path replacements (sensitive paths → natural paths)
const PATH_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  // macOS user paths
  { pattern: /\/Users\/[^/\s]+/gi, replacement: '/home/user' },
  // Linux user paths
  { pattern: /\/home\/[^/\s]+/gi, replacement: '/home/user' },
  // Home directory shorthand
  { pattern: /~\/[^/\s]*/gi, replacement: '~/workspace' },
  // Config directories
  { pattern: /\.iflow\//gi, replacement: '.config/' },
];

// Project name replacements (sensitive names → generic names)
const PROJECT_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  // Common project patterns - users can customize these
  { pattern: /\bapi-server\b/gi, replacement: 'server' },
  { pattern: /\bsdk-client\b/gi, replacement: 'client' },
  { pattern: /\bdb-storage\b/gi, replacement: 'database' },
  { pattern: /\brouter-service\b/gi, replacement: 'router' },
];

// File name replacements (sensitive config files → generic names)
const FILE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /settings\.json/gi, replacement: 'config.json' },
  { pattern: /\.env\b/gi, replacement: '.env' },
  { pattern: /credentials/gi, replacement: 'auth' },
  { pattern: /api[_-]?key/gi, replacement: 'key' },
  { pattern: /secret/gi, replacement: 'private' },
  { pattern: /token/gi, replacement: 'auth' },
  { pattern: /password/gi, replacement: 'pass' },
  { pattern: /\.pem\b/gi, replacement: '.key' },
];

// Content replacements (API Keys, URLs)
const CONTENT_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  // API Keys - preserve format but mask content
  { pattern: /sk-[a-zA-Z0-9]{20,}/gi, replacement: 'sk-xxxxxxxxxxxxxxxxxxxx' },
  { pattern: /ms-[a-zA-Z0-9-]{10,}/gi, replacement: 'ms-xxxxxxxxxx' },
  // API key assignments
  { pattern: /api[_-]?key\s*[:=]\s*['"]?[a-zA-Z0-9_-]{10,}/gi, replacement: 'api_key: "xxx"' },
  { pattern: /token\s*[:=]\s*['"]?[a-zA-Z0-9_-]{10,}/gi, replacement: 'token: "xxx"' },
  // Local URLs
  { pattern: /localhost:(\d{4,5})/gi, replacement: 'localhost:8080' },
  { pattern: /127\.0\.0\.1:(\d{4,5})/gi, replacement: '127.0.0.1:8080' },
];

/**
 * Sanitize a string by replacing sensitive information
 * Uses natural replacements to reduce fingerprinting
 */
export function sanitizeString(text: string | undefined | null): string {
  // Defensive check: ensure input is a string
  if (text === undefined || text === null) {
    return '';
  }
  if (typeof text !== 'string') {
    try {
      text = String(text);
    } catch {
      return '';
    }
  }
  
  let sanitized = text;
  
  // 1. Replace paths (highest priority, may contain usernames)
  for (const { pattern, replacement } of PATH_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  // 2. Replace project names
  for (const { pattern, replacement } of PROJECT_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  // 3. Replace file names
  for (const { pattern, replacement } of FILE_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  // 4. Replace sensitive content (API Keys, URLs)
  for (const { pattern, replacement } of CONTENT_REPLACEMENTS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  
  return sanitized;
}

/**
 * Sanitize messages array
 */
export function sanitizeMessages(messages: Array<{
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}>): Array<{
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}> {
  return messages.map(msg => {
    if (typeof msg.content === 'string') {
      return {
        ...msg,
        content: sanitizeString(msg.content),
      };
    }
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map(item => {
          if (item.type === 'text' && item.text) {
            return { ...item, text: sanitizeString(item.text) };
          }
          return item;
        }),
      };
    }
    return msg;
  });
}

/**
 * Detect sensitive information (for logging warnings)
 */
export function detectSensitiveInfo(text: string): string[] {
  const detected: string[] = [];
  const allPatterns = [
    ...PATH_REPLACEMENTS,
    ...PROJECT_REPLACEMENTS,
    ...CONTENT_REPLACEMENTS,
  ].map(r => r.pattern);
  
  for (const pattern of allPatterns) {
    if (pattern.test(text)) {
      detected.push(pattern.source.substring(0, 50));
    }
    pattern.lastIndex = 0;
  }
  
  return detected;
}

/**
 * Redact text for logging
 */
export function redactForLog(text: string, maxLength: number = 200): string {
  let redacted = sanitizeString(text);
  if (redacted.length > maxLength) {
    redacted = redacted.substring(0, maxLength) + '...';
  }
  return redacted;
}
