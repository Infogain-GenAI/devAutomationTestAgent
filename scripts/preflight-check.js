#!/usr/bin/env node
'use strict';

/**
 * Pre-Flight Validation Script
 * Validates configuration and tests AI provider connectivity BEFORE running the agent
 * 
 * Usage: node scripts/preflight-check.js
 * 
 * This script ensures:
 * 1. All required environment variables are set
 * 2. AI provider API key is valid and working
 * 3. Configuration is valid
 * 4. Dependencies are installed
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Simple logger that writes to both console and file
const logFile = path.join(logsDir, `preflight-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const log = (level, message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} [${level}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(logFile, logMessage + '\n');
};

log('info', '='.repeat(70));
log('info', '  IGNIS Pre-Flight Validation');
log('info', '='.repeat(70));
log('info', '');
log('info', `Log file: ${logFile}`);
log('info', '');

let hasErrors = false;
let hasWarnings = false;

// Check 1: Environment Variables
log('info', '1. Checking Environment Variables');
log('info', '-'.repeat(70));

const requiredEnvVars = {
  'GITHUB_TOKEN': 'GitHub personal access token',
  'AI_PROVIDER': 'AI provider (openai, claude, or gemini)',
};

const aiProviders = {
  'openai': 'OPENAI_API_KEY',
  'claude': 'CLAUDE_API_KEY',
  'gemini': 'GEMINI_API_KEY'
};

// Check required vars
Object.entries(requiredEnvVars).forEach(([key, description]) => {
  if (process.env[key]) {
    log('info', `  ✓ ${key}: Set`);
  } else {
    log('error', `  ✗ ${key}: Missing (${description})`);
    hasErrors = true;
  }
});

// Check AI provider specific key
const aiProvider = process.env.AI_PROVIDER || 'openai';
const aiKeyName = aiProviders[aiProvider];

if (aiKeyName) {
  if (process.env[aiKeyName] || process.env.AI_API_KEY) {
    log('info', `  ✓ ${aiKeyName}: Set (for provider: ${aiProvider})`);
  } else {
    log('error', `  ✗ ${aiKeyName}: Missing (required for ${aiProvider})`);
    hasErrors = true;
  }
} else {
  log('error', `  ✗ Invalid AI_PROVIDER: ${aiProvider} (must be: openai, claude, or gemini)`);
  hasErrors = true;
}

log('info', '');

// Check 2: Configuration Validation
log('info', '2. Configuration Validation');
log('info', '-'.repeat(70));

try {
  const defaultConfig = require('../src/config/default');
  log('info', '  ✓ Configuration loaded');
  
  const { validateConfig } = require('../src/config/schema');
  const validated = validateConfig(defaultConfig);
  log('info', '  ✓ Configuration schema valid');
  log('info', `  ✓ AI Provider: ${validated.ai.provider}`);
  log('info', `  ✓ Max Iterations: ${validated.agent.maxIterations}`);
} catch (err) {
  log('error', `  ✗ Configuration error: ${err.message}`);
  hasErrors = true;
}

log('info', '');

// Check 3: Dependencies
log('info', '3. Dependency Check');
log('info', '-'.repeat(70));

const requiredModules = [
  'dotenv',
  'winston',
  'joi',
  'express',
  'playwright',
  '@octokit/rest'
];

// Add AI provider specific module
const aiModules = {
  'openai': 'openai',
  'claude': '@anthropic-ai/sdk',
  'gemini': '@google/generative-ai'
};

if (aiModules[aiProvider]) {
  requiredModules.push(aiModules[aiProvider]);
}

requiredModules.forEach(moduleName => {
  try {
    require.resolve(moduleName);
    log('info', `  ✓ ${moduleName}`);
  } catch (err) {
    log('error', `  ✗ ${moduleName} - NOT INSTALLED`);
    hasErrors = true;
  }
});

log('info', '');

// Check 4: AI Provider Connectivity Test
log('info', '4. AI Provider Connectivity Test');
log('info', '-'.repeat(70));

async function testAIProvider() {
  const provider = process.env.AI_PROVIDER || 'openai';
  
  try {
    if (provider === 'openai') {
      const OpenAI = require('openai');
      const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
      
      if (!apiKey) {
        throw new Error('OpenAI API key not found');
      }
      
      log('info', '  Testing OpenAI API key...');
      const client = new OpenAI({ apiKey });
      
      // Simple test: list models (lightweight API call)
      const response = await client.models.list();
      
      if (response && response.data) {
        log('info', `  ✓ OpenAI API key is VALID`);
        log('info', `  ✓ Available models: ${response.data.length}`);
        
        // Check if gpt-4-turbo is available
        const hasGPT4 = response.data.some(m => m.id.includes('gpt-4'));
        if (hasGPT4) {
          log('info', `  ✓ GPT-4 models accessible`);
        } else {
          log('warn', `  ⚠ GPT-4 models not found - check your API tier`);
          hasWarnings = true;
        }
      } else {
        throw new Error('Unexpected API response');
      }
      
    } else if (provider === 'claude') {
      const Anthropic = require('@anthropic-ai/sdk');
      const apiKey = process.env.CLAUDE_API_KEY || process.env.AI_API_KEY;
      
      if (!apiKey) {
        throw new Error('Claude API key not found');
      }
      
      log('info', '  Testing Claude API key...');
      const client = new Anthropic({ apiKey });
      
      // Simple test: send a minimal message
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'test' }]
      });
      
      if (response) {
        log('info', `  ✓ Claude API key is VALID`);
        log('info', `  ✓ Model: ${response.model}`);
      }
      
    } else if (provider === 'gemini') {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
      
      if (!apiKey) {
        throw new Error('Gemini API key not found');
      }
      
      log('info', '  Testing Gemini API key...');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
      
      // Simple test: generate minimal content
      const result = await model.generateContent('test');
      const response = await result.response;
      
      if (response) {
        log('info', `  ✓ Gemini API key is VALID`);
      }
    }
    
  } catch (err) {
    log('error', `  ✗ ${provider.toUpperCase()} API test FAILED: ${err.message}`);
    
    if (err.message.includes('401') || err.message.includes('authentication')) {
      log('error', '  → Invalid API key or authentication failed');
    } else if (err.message.includes('403')) {
      log('error', '  → API key valid but access denied - check permissions/quota');
    } else if (err.message.includes('429')) {
      log('error', '  → Rate limit exceeded - wait and try again');
    } else if (err.message.includes('network') || err.message.includes('ENOTFOUND')) {
      log('error', '  → Network connectivity issue');
    }
    
    hasErrors = true;
  }
}

// Run async tests
(async () => {
  if (!hasErrors) {
    await testAIProvider();
  } else {
    log('warn', '  ⚠ Skipping AI provider test due to previous errors');
  }
  
  log('info', '');
  
  // Check 5: File Structure
  log('info', '5. File Structure Check');
  log('info', '-'.repeat(70));
  
  const requiredFiles = [
    'src/cli.js',
    'src/index.js',
    'src/config/default.js',
    'src/ai/provider-factory.js',
    'config/analysis-prompts.json',
    'package.json'
  ];
  
  requiredFiles.forEach(file => {
    const fullPath = path.join(__dirname, '..', file);
    if (fs.existsSync(fullPath)) {
      log('info', `  ✓ ${file}`);
    } else {
      log('error', `  ✗ ${file} - MISSING`);
      hasErrors = true;
    }
  });
  
  log('info', '');
  
  // Summary
  log('info', '='.repeat(70));
  log('info', '  Pre-Flight Summary');
  log('info', '='.repeat(70));
  log('info', '');
  
  if (hasErrors) {
    log('error', '❌ PRE-FLIGHT CHECK FAILED');
    log('error', 'Please fix the errors above before running the agent');
    log('error', '');
    log('info', `Full log: ${logFile}`);
    process.exit(1);
  } else if (hasWarnings) {
    log('warn', '⚠️  PRE-FLIGHT CHECK PASSED WITH WARNINGS');
    log('warn', 'Review warnings above - agent will run but may have issues');
    log('info', '');
    log('info', `Full log: ${logFile}`);
    process.exit(0);
  } else {
    log('info', '✅ PRE-FLIGHT CHECK PASSED');
    log('info', 'All checks passed - ready to run the agent!');
    log('info', '');
    log('info', `Full log: ${logFile}`);
    process.exit(0);
  }
})();
