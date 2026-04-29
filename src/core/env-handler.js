'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');

class EnvHandler {
  /**
   * Detect environment variables the target app requires.
   * Parses .env.example, docker-compose.yml, and source code references.
   */
  static detectRequiredEnvVars(workDir) {
    const envVars = new Map();

    // 1. Parse .env.example
    const envExample = path.join(workDir, '.env.example');
    if (fs.existsSync(envExample)) {
      const content = fs.readFileSync(envExample, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim();
          envVars.set(key, { source: '.env.example', exampleValue: val });
        }
      }
    }

    // 2. Parse docker-compose.yml for environment entries
    const composeFile = path.join(workDir, 'docker-compose.yml');
    if (fs.existsSync(composeFile)) {
      const content = fs.readFileSync(composeFile, 'utf-8');
      const envMatches = content.match(/^\s*-\s*([A-Z_][A-Z0-9_]*)=/gm) || [];
      for (const match of envMatches) {
        const key = match.replace(/^\s*-\s*/, '').replace('=', '');
        if (!envVars.has(key)) {
          envVars.set(key, { source: 'docker-compose.yml', exampleValue: '' });
        }
      }
    }

    // 3. Scan source files for process.env references
    const srcDir = path.join(workDir, 'src');
    if (fs.existsSync(srcDir)) {
      EnvHandler._scanForEnvRefs(srcDir, envVars);
    }

    logger.info(`Detected ${envVars.size} environment variables`);
    return envVars;
  }

  /**
   * Resolve environment variables from multiple sources.
   * Priority: providedSecrets > existing .env > .env.example > auto-generated
   */
  static resolveEnvironment(workDir, providedSecrets = {}) {
    const required = EnvHandler.detectRequiredEnvVars(workDir);
    const resolved = new Map();
    const sources = {};

    // 1. Provided secrets (highest priority)
    for (const [key, value] of Object.entries(providedSecrets)) {
      resolved.set(key, value);
      sources[key] = 'provided';
    }

    // 2. Existing .env file
    const envFile = path.join(workDir, '.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim();
          if (!resolved.has(key)) {
            resolved.set(key, val);
            sources[key] = 'existing-.env';
          }
        }
      }
    }

    // 3. .env.example values
    for (const [key, info] of required) {
      if (!resolved.has(key) && info.exampleValue) {
        resolved.set(key, info.exampleValue);
        sources[key] = '.env.example';
      }
    }

    // 4. Auto-generate mock values for remaining
    for (const [key] of required) {
      if (!resolved.has(key)) {
        const mockValue = EnvHandler.generateMockValue(key);
        resolved.set(key, mockValue);
        sources[key] = 'auto-generated';
      }
    }

    // Always ensure NODE_ENV is set
    if (!resolved.has('NODE_ENV')) {
      resolved.set('NODE_ENV', 'test');
      sources['NODE_ENV'] = 'auto-generated';
    }

    const providedCount = Object.values(sources).filter(s => s === 'provided').length;
    const mockedCount = Object.values(sources).filter(s => s === 'auto-generated').length;
    logger.info(`Environment resolved: ${providedCount} provided, ${mockedCount} auto-generated, ${resolved.size} total`);

    return { envMap: Object.fromEntries(resolved), sources };
  }

  /**
   * Generate a safe mock value for an environment variable.
   */
  static generateMockValue(key) {
    const upper = key.toUpperCase();

    if (upper.includes('DATABASE_URL') || upper.includes('DB_URL')) {
      return 'postgresql://test:test@localhost:5432/testdb';
    }
    if (upper.includes('REDIS_URL')) {
      return 'redis://localhost:6379';
    }
    if (upper.includes('MONGO') && upper.includes('URL')) {
      return 'mongodb://localhost:27017/testdb';
    }
    if (upper.includes('SECRET') || upper.includes('JWT')) {
      return crypto.randomBytes(32).toString('hex');
    }
    if (upper.includes('API_KEY') || upper.includes('TOKEN') || upper.includes('_KEY')) {
      return `mock_${key.toLowerCase()}_${crypto.randomBytes(8).toString('hex')}`;
    }
    if (upper === 'PORT' || upper.includes('_PORT')) {
      return '3000';
    }
    if (upper === 'HOST' || upper.includes('_HOST')) {
      return 'localhost';
    }
    if (upper.includes('NODE_ENV') || upper.includes('ENV')) {
      return 'test';
    }
    if (upper.includes('URL') || upper.includes('ENDPOINT')) {
      return 'http://localhost:3000';
    }
    if (upper.includes('EMAIL')) {
      return 'test@example.com';
    }
    if (upper.includes('PASSWORD') || upper.includes('PASS')) {
      return crypto.randomBytes(16).toString('hex');
    }

    return `mock_${key.toLowerCase()}`;
  }

  /**
   * Write resolved environment variables to a .env file.
   */
  static writeEnvFile(workDir, envMap) {
    const envPath = path.join(workDir, '.env');
    const lines = ['# Auto-generated by IGNIS Automation Test Agent'];
    for (const [key, value] of Object.entries(envMap)) {
      // Quote values that contain spaces or special characters
      const needsQuotes = /[\s#"'$`\\]/.test(value);
      lines.push(needsQuotes ? `${key}="${value}"` : `${key}=${value}`);
    }
    fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
    logger.info(`Wrote .env file with ${Object.keys(envMap).length} variables`);
  }

  /**
   * Recursively scan source files for process.env.VARIABLE_NAME references.
   */
  static _scanForEnvRefs(dir, envVars, depth = 0) {
    if (depth > 5) return; // limit recursion

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        EnvHandler._scanForEnvRefs(fullPath, envVars, depth + 1);
      } else if (/\.(js|ts|jsx|tsx|py)$/.test(entry.name)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const matches = content.match(/process\.env\.([A-Z_][A-Z0-9_]*)/g) || [];
          for (const match of matches) {
            const key = match.replace('process.env.', '');
            if (!envVars.has(key)) {
              envVars.set(key, { source: 'source-scan', exampleValue: '' });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }
}

module.exports = EnvHandler;
