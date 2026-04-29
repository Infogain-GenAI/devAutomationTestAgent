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

    // Write summary to file for artifact upload
    const outputDir = path.join(repoPath, 'test-results');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'ignis-summary.json'),
      JSON.stringify(summary, null, 2),
      'utf-8'
    );

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

main();
