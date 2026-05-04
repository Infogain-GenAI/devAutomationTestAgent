#!/usr/bin/env node
'use strict';

/**
 * Container Diagnostic Script
 * Run this script inside the container to debug path issues
 * Usage: docker run --rm -v "$(pwd):/workspace" <image> node /app/scripts/diagnose-container.js
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(70));
console.log('  IGNIS Container Diagnostic Report');
console.log('='.repeat(70));
console.log();

// 1. Working Directory
console.log('1. Working Directory:');
console.log('-'.repeat(70));
console.log('   Current directory:', process.cwd());
console.log('   __dirname:', __dirname);
console.log();

// 2. Environment Variables
console.log('2. Environment Variables:');
console.log('-'.repeat(70));
const envVars = [
  'REPO_PATH',
  'GITHUB_WORKSPACE',
  'REPO_BRANCH',
  'AI_PROVIDER',
  'NODE_ENV',
  'AGENT_WORK_DIR',
  'ANALYSIS_PROMPT_FILE',
  'LOG_LEVEL'
];
envVars.forEach(varName => {
  console.log(`   ${varName}: ${process.env[varName] || '(not set)'}`);
});
console.log();

// 3. File System Checks
console.log('3. File System Checks:');
console.log('-'.repeat(70));

const pathsToCheck = [
  '/app',
  '/app/src',
  '/app/src/cli.js',
  '/app/src/index.js',
  '/app/config',
  '/app/config/analysis-prompts.json',
  '/app/node_modules',
  '/app/workspace',
  '/workspace',
  process.env.REPO_PATH || '/workspace',
  process.env.GITHUB_WORKSPACE || '(not set)',
];

pathsToCheck.forEach(checkPath => {
  if (checkPath === '(not set)') return;
  try {
    const stats = fs.statSync(checkPath);
    const type = stats.isDirectory() ? 'DIR ' : 'FILE';
    console.log(`   ✓ ${type} ${checkPath}`);
  } catch (err) {
    console.log(`   ✗ MISS ${checkPath}`);
  }
});
console.log();

// 4. Repository Contents
console.log('4. Repository Contents (REPO_PATH):');
console.log('-'.repeat(70));
const repoPath = process.env.REPO_PATH || process.env.GITHUB_WORKSPACE || '/workspace';
try {
  const entries = fs.readdirSync(repoPath);
  console.log(`   Found ${entries.length} items in ${repoPath}:`);
  entries.slice(0, 20).forEach(entry => {
    const fullPath = path.join(repoPath, entry);
    const stats = fs.statSync(fullPath);
    const type = stats.isDirectory() ? '📁' : '📄';
    console.log(`   ${type} ${entry}`);
  });
  if (entries.length > 20) {
    console.log(`   ... and ${entries.length - 20} more`);
  }
} catch (err) {
  console.log(`   ✗ Cannot read directory: ${err.message}`);
}
console.log();

// 5. Node.js Version & Module Resolution
console.log('5. Node.js Environment:');
console.log('-'.repeat(70));
console.log('   Node version:', process.version);
console.log('   Platform:', process.platform);
console.log('   Architecture:', process.arch);
console.log('   Module paths:', process.env.NODE_PATH || '(default)');
console.log();

// 6. Required Module Checks
console.log('6. Required Modules:');
console.log('-'.repeat(70));
const requiredModules = [
  'dotenv',
  'winston',
  'joi',
  'openai',
  '@anthropic-ai/sdk',
  '@google/generative-ai',
  'playwright',
  '@octokit/rest'
];

requiredModules.forEach(moduleName => {
  try {
    require.resolve(moduleName);
    console.log(`   ✓ ${moduleName}`);
  } catch (err) {
    console.log(`   ✗ ${moduleName} - NOT FOUND`);
  }
});
console.log();

// 7. Configuration Loading Test
console.log('7. Configuration Loading Test:');
console.log('-'.repeat(70));
try {
  require('dotenv').config();
  console.log('   ✓ dotenv loaded');
  
  const defaultConfig = require('../config/default');
  console.log('   ✓ default config loaded');
  console.log('   AI Provider:', defaultConfig.ai.provider);
  console.log('   Agent Work Dir:', defaultConfig.agent.workDir);
  
  const { validateConfig } = require('../config/schema');
  console.log('   ✓ schema validation loaded');
  
  const validated = validateConfig(defaultConfig);
  console.log('   ✓ configuration validation passed');
} catch (err) {
  console.log(`   ✗ Configuration error: ${err.message}`);
  console.log('   Stack:', err.stack);
}
console.log();

// 8. Summary
console.log('='.repeat(70));
console.log('  Diagnostic Complete');
console.log('='.repeat(70));
console.log();
console.log('Expected Configuration:');
console.log('  • Working directory should be: /app');
console.log('  • REPO_PATH should be: /workspace');
console.log('  • Test repo should be mounted at: /workspace');
console.log('  • Agent code should be at: /app/src/cli.js');
console.log('  • Config should be at: /app/config/analysis-prompts.json');
console.log();

process.exit(0);
