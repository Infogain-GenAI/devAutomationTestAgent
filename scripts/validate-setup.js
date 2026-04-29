#!/usr/bin/env node

/**
 * IGNIS Test Agent - Configuration Validator
 * 
 * Run this script to validate your setup before deploying:
 * node scripts/validate-setup.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function header(title) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`  ${title}`, 'cyan');
  log('='.repeat(60), 'cyan');
}

function checkmark() { return '✓'; }
function crossmark() { return '✗'; }

let errors = 0;
let warnings = 0;

// Validation functions
function checkFileExists(filePath, name, required = true) {
  const fullPath = path.resolve(filePath);
  const exists = fs.existsSync(fullPath);
  
  if (exists) {
    log(`${checkmark()} ${name}: Found`, 'green');
    return true;
  } else {
    if (required) {
      log(`${crossmark()} ${name}: Missing (required)`, 'red');
      errors++;
    } else {
      log(`⚠ ${name}: Missing (optional)`, 'yellow');
      warnings++;
    }
    return false;
  }
}

function checkEnvVariable(varName, required = true) {
  const value = process.env[varName];
  
  if (value) {
    log(`${checkmark()} ${varName}: Set`, 'green');
    return true;
  } else {
    if (required) {
      log(`${crossmark()} ${varName}: Not set (required)`, 'red');
      errors++;
    } else {
      log(`⚠ ${varName}: Not set (optional)`, 'yellow');
      warnings++;
    }
    return false;
  }
}

function validateConfig() {
  header('Configuration Validation');
  
  // Check required files
  checkFileExists('package.json', 'package.json');
  checkFileExists('src/index.js', 'Main entry point');
  checkFileExists('src/cli.js', 'CLI entry point');
  checkFileExists('src/core/agent-orchestrator.js', 'Agent orchestrator');
  checkFileExists('config/analysis-prompts.json', 'Analysis prompts config');
  
  // Check optional files
  checkFileExists('.env', '.env file', false);
  checkFileExists('Dockerfile', 'Dockerfile', false);
}

function validateEnvVariables() {
  header('Environment Variables');
  
  log('\n📝 Loading .env file...', 'blue');
  
  // Try to load .env
  const envPath = path.resolve('.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config();
    log('✓ .env file loaded', 'green');
  } else {
    log('⚠ .env file not found (will use system env vars)', 'yellow');
  }
  
  log('\n🔑 Required Variables:', 'blue');
  checkEnvVariable('GITHUB_TOKEN');
  
  // AI Provider check
  log('\n🤖 AI Provider (at least one required):', 'blue');
  const hasAI = checkEnvVariable('CLAUDE_API_KEY', false) ||
                checkEnvVariable('OPENAI_API_KEY', false) ||
                checkEnvVariable('GEMINI_API_KEY', false);
  
  if (!hasAI) {
    log(`${crossmark()} No AI provider API key found!`, 'red');
    errors++;
  }
  
  log('\n⚙️ Optional Variables:', 'blue');
  checkEnvVariable('REPO_BRANCH', false);
  checkEnvVariable('MAX_ITERATIONS', false);
  checkEnvVariable('ENABLE_BACKEND_VALIDATION', false);
  checkEnvVariable('GENERATE_ANALYSIS_REPORT', false);
}

function validateDependencies() {
  header('Dependencies');
  
  log('\n📦 Checking package.json...', 'blue');
  
  try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    const requiredDeps = [
      '@anthropic-ai/sdk',
      '@octokit/rest',
      'playwright',
      'express',
      'dotenv',
      'winston'
    ];
    
    for (const dep of requiredDeps) {
      if (packageJson.dependencies?.[dep]) {
        log(`${checkmark()} ${dep}: ${packageJson.dependencies[dep]}`, 'green');
      } else {
        log(`${crossmark()} ${dep}: Missing`, 'red');
        errors++;
      }
    }
    
    log('\n📥 Checking node_modules...', 'blue');
    if (fs.existsSync('node_modules')) {
      log(`${checkmark()} node_modules directory exists`, 'green');
    } else {
      log(`${crossmark()} node_modules not found. Run: npm install`, 'red');
      errors++;
    }
    
  } catch (err) {
    log(`${crossmark()} Failed to read package.json: ${err.message}`, 'red');
    errors++;
  }
}

function validateDirectoryStructure() {
  header('Directory Structure');
  
  const requiredDirs = [
    'src',
    'src/core',
    'src/ai',
    'src/api',
    'src/utils',
    'src/models',
    'config'
  ];
  
  for (const dir of requiredDirs) {
    checkFileExists(dir, `Directory: ${dir}`);
  }
  
  log('\n📁 Optional directories:', 'blue');
  checkFileExists('logs', 'logs/', false);
  checkFileExists('reports', 'reports/', false);
  checkFileExists('workspace', 'workspace/', false);
}

function validateGitHubAction() {
  header('GitHub Action Setup');
  
  log('\n📋 Checking workflow files...', 'blue');
  
  const workflowDir = '.github/workflows';
  if (fs.existsSync(workflowDir)) {
    const files = fs.readdirSync(workflowDir);
    const ymlFiles = files.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    
    if (ymlFiles.length > 0) {
      log(`${checkmark()} Found ${ymlFiles.length} workflow file(s)`, 'green');
      ymlFiles.forEach(f => log(`  - ${f}`, 'blue'));
    } else {
      log(`⚠ No workflow files found in ${workflowDir}`, 'yellow');
      warnings++;
    }
  } else {
    log(`⚠ ${workflowDir} directory not found`, 'yellow');
    warnings++;
  }
}

function validateAnalysisPrompts() {
  header('Analysis Prompts Configuration');
  
  const promptsPath = 'config/analysis-prompts.json';
  
  if (!fs.existsSync(promptsPath)) {
    log(`${crossmark()} ${promptsPath} not found`, 'red');
    errors++;
    return;
  }
  
  try {
    const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
    
    log('\n🔍 Validating structure...', 'blue');
    
    const requiredSections = ['backend', 'frontend', 'general', 'report'];
    for (const section of requiredSections) {
      if (prompts[section]) {
        log(`${checkmark()} Section '${section}': Present`, 'green');
      } else {
        log(`${crossmark()} Section '${section}': Missing`, 'red');
        errors++;
      }
    }
    
    // Check backend validation config
    if (prompts.backend?.endpoint_validation) {
      const checksCount = prompts.backend.endpoint_validation.checks?.length || 0;
      log(`${checkmark()} Backend validation checks: ${checksCount}`, 'green');
    }
    
    if (prompts.backend?.best_practices) {
      const rulesCount = prompts.backend.best_practices.rules?.length || 0;
      log(`${checkmark()} Best practices rules: ${rulesCount}`, 'green');
    }
    
  } catch (err) {
    log(`${crossmark()} Failed to parse ${promptsPath}: ${err.message}`, 'red');
    errors++;
  }
}

function printSummary() {
  header('Validation Summary');
  
  if (errors === 0 && warnings === 0) {
    log('\n🎉 All checks passed! Your setup is ready.', 'green');
    log('\nNext steps:', 'blue');
    log('  1. Push your code to GitHub', 'cyan');
    log('  2. Run the workflow manually or push to trigger', 'cyan');
    log('  3. Monitor the Actions tab for results', 'cyan');
  } else {
    log(`\n📊 Results:`, 'blue');
    log(`  Errors: ${errors}`, errors > 0 ? 'red' : 'green');
    log(`  Warnings: ${warnings}`, warnings > 0 ? 'yellow' : 'green');
    
    if (errors > 0) {
      log('\n❌ Please fix the errors above before deploying.', 'red');
      process.exit(1);
    } else {
      log('\n⚠️  Warnings found. Review them, but you can proceed.', 'yellow');
    }
  }
  
  log('\n📖 Documentation:', 'blue');
  log('  - Quick Start: ./QUICK-START.md', 'cyan');
  log('  - Deployment Guide: ./DEPLOYMENT-GUIDE.md', 'cyan');
  log('  - Main README: ./README.md', 'cyan');
  log('');
}

// Main execution
function main() {
  log('\n🔬 IGNIS Test Agent - Setup Validator', 'cyan');
  log('   Validating your configuration...\n', 'cyan');
  
  try {
    validateConfig();
    validateEnvVariables();
    validateDependencies();
    validateDirectoryStructure();
    validateGitHubAction();
    validateAnalysisPrompts();
    printSummary();
  } catch (err) {
    log(`\n${crossmark()} Validation failed with error:`, 'red');
    console.error(err);
    process.exit(1);
  }
}

// Run validator
main();
