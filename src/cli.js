#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const defaultConfig = require('./config/default');
const { validateConfig } = require('./config/schema');
const AgentOrchestrator = require('./core/agent-orchestrator');

async function main() {
  logger.info('IGNIS Automation Test Agent — CLI Mode (Primary)');
  logger.info('================================================');

  // Pre-flight validation
  logger.info('🔍 Pre-flight checks...');
  
  // Check required environment variables
  const aiProvider = process.env.AI_PROVIDER || 'openai';
  const aiApiKey = process.env.AI_API_KEY || 
                   process.env.OPENAI_API_KEY || 
                   process.env.CLAUDE_API_KEY || 
                   process.env.GEMINI_API_KEY;
  
  if (!aiApiKey) {
    logger.error('❌ No AI API key found in environment variables');
    logger.error('   Expected one of: AI_API_KEY, OPENAI_API_KEY, CLAUDE_API_KEY, GEMINI_API_KEY');
    throw new Error('Missing required AI API key');
  }
  
  logger.info(`✅ AI Provider: ${aiProvider}`);
  logger.info(`✅ AI API Key: ${aiApiKey.substring(0, 10)}...`);

  // Build config from environment variables
  const config = {
    ...defaultConfig,
    app: {
      ...defaultConfig.app,
      autoStart: process.env.AUTO_START_APP === 'true',
      startCommand: process.env.APP_START_COMMAND || null,
      url: process.env.APP_URL || null
    }
  };

  // Validate config
  let validatedConfig;
  try {
    validatedConfig = validateConfig(config);
  } catch (err) {
    logger.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }

  // Determine workspace path (same repo — checked out by actions/checkout)
  const repoPath = process.env.REPO_PATH || process.env.GITHUB_WORKSPACE || process.cwd();
  const branch = process.env.REPO_BRANCH || validatedConfig.agent.branch || 'main';

  // Validate repository path exists
  if (!fs.existsSync(repoPath)) {
    logger.error(`❌ Repository path does not exist: ${repoPath}`);
    throw new Error(`Repository path not found: ${repoPath}`);
  }
  
  const repoStats = fs.statSync(repoPath);
  if (!repoStats.isDirectory()) {
    logger.error(`❌ Repository path is not a directory: ${repoPath}`);
    throw new Error(`Repository path must be a directory: ${repoPath}`);
  }

  logger.info(`Repository path: ${repoPath}`);
  logger.info(`Base branch: ${branch}`);
  logger.info(`AI Provider: ${validatedConfig.ai.provider}`);
  logger.info(`Max iterations: ${validatedConfig.agent.maxIterations}`);
  logger.info(`Test types: ${validatedConfig.testing.types.join(', ')}`);

  // Parse app secrets if provided
  let appSecrets = {};
  if (process.env.APP_SECRETS) {
    try {
      appSecrets = JSON.parse(process.env.APP_SECRETS);
    } catch (err) {
      logger.warn(`Failed to parse APP_SECRETS: ${err.message}`);
    }
  }

  // Create and run orchestrator
  const orchestrator = new AgentOrchestrator(validatedConfig);

  try {
    const summary = await orchestrator.run({
      repoPath,
      branch,
      mode: 'cli',
      appSecrets,
      autoStartApp: validatedConfig.app.autoStart,
      appStartCommand: validatedConfig.app.startCommand,
      appUrl: validatedConfig.app.url,
      techStackOverride: process.env.TECH_STACK_OVERRIDE
        ? JSON.parse(process.env.TECH_STACK_OVERRIDE)
        : {}
    });

    // Write GitHub Actions step summary
    writeStepSummary(orchestrator);

    // Write comprehensive run summary to logs
    writeRunSummaryLog(summary, repoPath);

    // Write summary to file for artifact upload
    const outputDir = path.join(repoPath, 'test-results');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'ignis-summary.json'),
      JSON.stringify(summary, null, 2),
      'utf-8'
    );
    
    // Copy logs to output directory for easy artifact upload
    copyLogsToOutputDir(outputDir);

    // Exit code based on result
    if (summary.status === 'all-passed') {
      logger.info('✅ All tests passed — exiting with code 0');
      process.exit(0);
    } else if (summary.status === 'partial') {
      logger.info('⚠️ Partial fixes applied — exiting with code 1');
      process.exit(1);
    } else {
      logger.info('❌ Run failed — exiting with code 1');
      process.exit(1);
    }

  } catch (err) {
    logger.error(`Agent run failed: ${err.message}`);

    // Write failure to step summary
    writeStepSummary(orchestrator, err);

    process.exit(1);
  }
}

/**
 * Write formatted summary to $GITHUB_STEP_SUMMARY (if running in GitHub Actions).
 */
function writeStepSummary(orchestrator, error) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    logger.debug('Not in GitHub Actions — skipping step summary');
    return;
  }

  try {
    let content;
    if (error) {
      content = `## ❌ IGNIS Automation Test Agent — Failed\n\n`;
      content += `**Error:** ${error.message}\n\n`;
      content += `**Run ID:** \`${orchestrator.getRunId()}\`\n`;
    } else {
      content = orchestrator.buildStepSummary();
    }

    fs.appendFileSync(summaryPath, content + '\n', 'utf-8');
    logger.info('Wrote GitHub Actions step summary');
  } catch (err) {
    logger.warn(`Failed to write step summary: ${err.message}`);
  }
}

/**
 * Write comprehensive run summary to log file.
 * This is especially important for GitHub Actions where container logs aren't easily accessible.
 */
function writeRunSummaryLog(summary, repoPath) {
  const logDir = process.env.LOG_DIR || 'logs';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const summaryLogFile = path.join(logDir, `run-summary-${timestamp}.log`);
  
  try {
    fs.mkdirSync(logDir, { recursive: true });
    
    const lines = [
      '═'.repeat(100),
      `IGNIS AUTOMATION TEST AGENT - RUN SUMMARY`,
      `Generated: ${new Date().toISOString()}`,
      `Repository: ${repoPath}`,
      `Run ID: ${summary.runId || 'N/A'}`,
      '═'.repeat(100),
      '',
      '📊 OVERALL STATUS',
      '-'.repeat(100),
      `Status:      ${summary.status ? summary.status.toUpperCase() : 'UNKNOWN'}`,
      `Duration:    ${summary.duration ? (summary.duration / 1000).toFixed(2) + 's' : 'N/A'}`,
      `Iterations:  ${summary.iteration || 0}`,
      '',
    ];
    
    // Test Results Summary
    if (summary.testResults) {
      lines.push('═'.repeat(100));
      lines.push('🧪 TEST RESULTS');
      lines.push('═'.repeat(100));
      lines.push('');
      lines.push(`Total Tests:  ${summary.testResults.total || 0}`);
      lines.push(`✅ Passed:    ${summary.testResults.passed || 0}`);
      lines.push(`❌ Failed:    ${summary.testResults.failed || 0}`);
      lines.push(`⏭️  Skipped:   ${summary.testResults.skipped || 0}`);
      lines.push(`⏱️  Duration:  ${summary.testResults.duration ? (summary.testResults.duration / 1000).toFixed(2) + 's' : 'N/A'}`);
      lines.push('');
      
      // Test failures breakdown
      if (summary.testResults.failures && summary.testResults.failures.length > 0) {
        lines.push('❌ Test Failures:');
        summary.testResults.failures.forEach((failure, idx) => {
          lines.push(`   ${idx + 1}. ${failure.testName || 'Unknown Test'}`);
          lines.push(`      File: ${failure.file || 'N/A'}`);
          lines.push(`      Category: ${failure.category || 'unknown'}`);
          if (failure.error) {
            lines.push(`      Error: ${failure.error.substring(0, 100)}...`);
          }
        });
        lines.push('');
      }
    }
    
    // Analysis Summary
    if (summary.analysis) {
      lines.push('═'.repeat(100));
      lines.push('🔍 CODE ANALYSIS');
      lines.push('═'.repeat(100));
      lines.push('');
      
      if (summary.analysis.structure) {
        lines.push(`Files Analyzed: ${summary.analysis.structure.totalFiles || 0}`);
        lines.push(`Total Size:     ${summary.analysis.structure.totalSize ? (summary.analysis.structure.totalSize / 1024).toFixed(2) + ' KB' : 'N/A'}`);
        lines.push('');
      }
      
      if (summary.analysis.routes) {
        lines.push(`Routes Detected:    ${summary.analysis.routes.length || 0}`);
      }
      
      if (summary.analysis.endpoints) {
        lines.push(`API Endpoints:      ${summary.analysis.endpoints.length || 0}`);
      }
      
      if (summary.analysis.components) {
        lines.push(`Components Found:   ${summary.analysis.components.length || 0}`);
      }
      lines.push('');
    }
    
    // Generated Tests
    if (summary.generatedTests) {
      lines.push('═'.repeat(100));
      lines.push('📝 GENERATED TESTS');
      lines.push('═'.repeat(100));
      lines.push('');
      lines.push(`Test Files Created: ${summary.generatedTests.length || 0}`);
      summary.generatedTests.forEach(test => {
        lines.push(`   - ${test.file || test}`);
      });
      lines.push('');
    }
    
    // Fixes Applied
    if (summary.fixes && summary.fixes.length > 0) {
      lines.push('═'.repeat(100));
      lines.push('🔧 FIXES APPLIED');
      lines.push('═'.repeat(100));
      lines.push('');
      lines.push(`Total Fixes: ${summary.fixes.length}`);
      summary.fixes.forEach((fix, idx) => {
        lines.push(`   ${idx + 1}. ${fix.description || fix.file || 'Unknown fix'}`);
      });
      lines.push('');
    }
    
    // Pull Requests
    if (summary.pullRequests && summary.pullRequests.length > 0) {
      lines.push('═'.repeat(100));
      lines.push('🔀 PULL REQUESTS CREATED');
      lines.push('═'.repeat(100));
      lines.push('');
      summary.pullRequests.forEach(pr => {
        lines.push(`   - PR #${pr.number || 'N/A'}: ${pr.title || 'Untitled'}`);
        lines.push(`     URL: ${pr.url || 'N/A'}`);
      });
      lines.push('');
    }
    
    // Errors
    if (summary.errors && summary.errors.length > 0) {
      lines.push('═'.repeat(100));
      lines.push('❌ ERRORS ENCOUNTERED');
      lines.push('═'.repeat(100));
      lines.push('');
      summary.errors.forEach((error, idx) => {
        lines.push(`   ${idx + 1}. ${error.message || error}`);
      });
      lines.push('');
    }
    
    // Final Status
    lines.push('═'.repeat(100));
    lines.push('🎯 FINAL STATUS');
    lines.push('═'.repeat(100));
    lines.push('');
    
    if (summary.status === 'all-passed') {
      lines.push('✅ SUCCESS: All tests passed!');
    } else if (summary.status === 'partial') {
      lines.push('⚠️  PARTIAL: Some fixes applied, but tests still failing');
    } else if (summary.status === 'failed') {
      lines.push('❌ FAILED: Tests failed and fixes were unsuccessful');
    } else {
      lines.push(`⚠️  UNKNOWN STATUS: ${summary.status || 'N/A'}`);
    }
    
    lines.push('');
    lines.push('═'.repeat(100));
    lines.push('📁 ARTIFACT LOCATIONS');
    lines.push('═'.repeat(100));
    lines.push('');
    lines.push(`Logs Directory:         ${logDir}`);
    lines.push(`Test Results:           ${path.join(repoPath, 'test-results')}`);
    lines.push(`Reports Directory:      ${path.join(repoPath, 'reports')}`);
    lines.push(`Generated Tests:        ${path.join(repoPath, 'generated-tests')}`);
    lines.push('');
    lines.push('💡 TIP: In GitHub Actions, upload these directories as artifacts:');
    lines.push('   - uses: actions/upload-artifact@v4');
    lines.push('     with:');
    lines.push('       name: ignis-results');
    lines.push('       path: |');
    lines.push('         logs/');
    lines.push('         test-results/');
    lines.push('         reports/');
    lines.push('         generated-tests/');
    lines.push('');
    lines.push('═'.repeat(100));
    lines.push(`END OF RUN SUMMARY - ${new Date().toISOString()}`);
    lines.push('═'.repeat(100));
    
    const logContent = lines.join('\n');
    fs.writeFileSync(summaryLogFile, logContent, 'utf-8');
    
    logger.info(`✅ Run summary written to: ${summaryLogFile}`);
    logger.info(`   📦 This file will be available in GitHub Actions artifacts`);
    
  } catch (err) {
    logger.warn(`Failed to write run summary log: ${err.message}`);
  }
}

/**
 * Copy logs directory to output directory for easier artifact collection in GitHub Actions.
 */
function copyLogsToOutputDir(outputDir) {
  const logDir = process.env.LOG_DIR || 'logs';
  const logsOutputDir = path.join(outputDir, 'logs');
  
  try {
    if (fs.existsSync(logDir)) {
      fs.mkdirSync(logsOutputDir, { recursive: true });
      
      const logFiles = fs.readdirSync(logDir);
      let copiedCount = 0;
      
      logFiles.forEach(file => {
        const srcPath = path.join(logDir, file);
        const destPath = path.join(logsOutputDir, file);
        
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, destPath);
          copiedCount++;
        }
      });
      
      logger.info(`✅ Copied ${copiedCount} log file(s) to ${logsOutputDir}`);
      logger.info(`   📦 Logs are now in test-results/ directory for GitHub Actions artifact upload`);
    }
  } catch (err) {
    logger.warn(`Failed to copy logs to output directory: ${err.message}`);
  }
}

// Run main with proper error handling
main().catch(err => {
  console.error('═'.repeat(80));
  console.error('❌ FATAL ERROR - IGNIS Agent Failed to Start');
  console.error('═'.repeat(80));
  console.error(`Error: ${err.message}`);
  console.error(`Stack: ${err.stack}`);
  console.error('═'.repeat(80));
  console.error('');
  console.error('🔍 Common Issues:');
  console.error('  1. Missing required environment variables (AI_API_KEY, REPO_PATH)');
  console.error('  2. Invalid configuration in config files');
  console.error('  3. Network issues connecting to AI provider');
  console.error('  4. Insufficient permissions in workspace directory');
  console.error('');
  console.error('📖 Check logs in: logs/error.log and logs/combined.log');
  console.error('');
  
  // Also log through logger if available
  logger.error('═'.repeat(80));
  logger.error('❌ FATAL ERROR - IGNIS Agent Failed to Start');
  logger.error('═'.repeat(80));
  logger.error(`Error: ${err.message}`);
  logger.error(`Stack: ${err.stack}`);
  logger.error('═'.repeat(80));
  
  process.exit(1);
});
