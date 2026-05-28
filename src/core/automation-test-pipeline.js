'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const promptLoader = require('../utils/prompt-loader');

/**
 * Automation Test Pipeline — Dedicated orchestrator for E2E/API test generation & execution.
 * 
 * Pipeline Stages:
 *   1. Dependency Verification (Playwright browsers, @playwright/test)
 *   2. Generate E2E/API tests (based on API documentation and routes)
 *   3. Verify test quality (selectors, assertions, coverage)
 *   4. Run automation tests with detailed logging
 *   5. Fix failures iteratively with AI analysis
 *   6. Generate comprehensive report
 * 
 * Uses separated prompt templates:
 *   - config/prompts/system-generate-tests.md (for E2E/API tests)
 *   - config/prompts/system-analyze-failures.md (failure analysis)
 *   - config/prompts/system-generate-fix.md (fix generation)
 */
class AutomationTestPipeline {
  constructor(config, dependencies) {
    this.config = config;
    this.aiProvider = dependencies.aiProvider;
    this.codeGenProvider = dependencies.codeGenProvider || dependencies.aiProvider;
    this.testRunner = dependencies.testRunner;
    this.issueFixer = dependencies.issueFixer;
    this.promptLoader = promptLoader;

    this.maxFixIterations = config.maxFixIterations || 3;
    this.maxChunks = config.maxAutomationTestChunks || 8;
  }

  /**
   * Execute the full automation test pipeline.
   * 
   * @param {object} context - Pipeline context
   * @param {string} context.workDir - Workspace directory
   * @param {object} context.techStack - Tech stack
   * @param {object} context.codeAnalysis - Code analysis
   * @param {object} context.apiDocumentation - API documentation
   * @param {string} context.appUrl - Running app URL
   * @returns {object} Pipeline results with coverage, test results, and reports
   */
  async execute(context) {
    const { workDir, techStack, codeAnalysis, apiDocumentation, appUrl } = context;
    const startTime = Date.now();

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('  AUTOMATION TEST PIPELINE — Starting');
    logger.info('═══════════════════════════════════════════════════════════');

    // ── Stage 1: Verify Playwright ───────────────────────────────
    logger.info('[automation-pipeline] Stage 1: Playwright Verification');
    await this._verifyPlaywright(workDir);

    // ── Stage 2: Generate E2E/API Tests ──────────────────────────
    logger.info('[automation-pipeline] Stage 2: E2E/API Test Generation');
    const generatedFiles = await this._generateAutomationTests(workDir, techStack, codeAnalysis, apiDocumentation);
    logger.info(`[automation-pipeline] ✅ Generated ${generatedFiles.length} automation test file(s)`);

    // ── Stage 3: Verify Test Quality ─────────────────────────────
    logger.info('[automation-pipeline] Stage 3: Test Verification');
    const verifiedFiles = await this._verifyTests(workDir, generatedFiles, techStack);
    logger.info(`[automation-pipeline] ✅ ${verifiedFiles.ready} files ready, ${verifiedFiles.fixed} fixed`);

    // ── Stage 4: Execute Tests ───────────────────────────────────
    logger.info('[automation-pipeline] Stage 4: Test Execution');
    let executionResult = await this._executeTests(workDir, appUrl);

    // ── Stage 5: Fix Failures (iterative) ────────────────────────
    if (executionResult.failed > 0 && this.maxFixIterations > 0) {
      logger.info(`[automation-pipeline] Stage 5: Fixing ${executionResult.failed} failure(s)...`);
      executionResult = await this._fixAndRerun(workDir, executionResult, techStack, codeAnalysis, appUrl);
    }

    // ── Stage 6: Generate Report ─────────────────────────────────
    logger.info('[automation-pipeline] Stage 6: Report Generation');
    const report = await this._generateReport(executionResult, workDir);

    const duration = Date.now() - startTime;
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`  AUTOMATION TEST PIPELINE — Complete (${(duration / 1000).toFixed(1)}s)`);
    logger.info(`  Coverage: ${executionResult.coverage || 0}% | Tests: ${executionResult.passed}/${executionResult.total}`);
    logger.info('═══════════════════════════════════════════════════════════');

    return {
      ...executionResult,
      generatedFiles: generatedFiles.length,
      report,
      duration
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 1: PLAYWRIGHT VERIFICATION
  // ═══════════════════════════════════════════════════════════════

  async _verifyPlaywright(workDir) {
    const { execSync } = require('child_process');

    // Check if Playwright is installed
    const hasPlaywright = this._isPackageAvailable('@playwright/test', workDir);
    if (!hasPlaywright) {
      logger.info('[automation-pipeline] Installing @playwright/test...');
      try {
        execSync('npm install --save-dev @playwright/test', {
          cwd: workDir,
          stdio: 'pipe',
          timeout: 120000,
          env: { ...process.env, NODE_ENV: 'development' }
        });
        logger.info('[automation-pipeline] ✅ @playwright/test installed');
      } catch (err) {
        logger.warn(`[automation-pipeline] Failed to install @playwright/test locally: ${err.message.slice(0, 100)}`);
      }
    }

    // Verify browsers installed
    try {
      execSync('npx playwright install chromium --with-deps', {
        cwd: workDir,
        stdio: 'pipe',
        timeout: 180000
      });
      logger.info('[automation-pipeline] ✅ Playwright browsers verified');
    } catch (err) {
      logger.warn(`[automation-pipeline] Playwright browser setup issue: ${err.message.slice(0, 100)}`);
    }

    // Set headless env vars
    if (!process.env.PLAYWRIGHT_HEADLESS) process.env.PLAYWRIGHT_HEADLESS = '1';
    if (!process.env.CI) process.env.CI = 'true';
    if (!process.env.HEADLESS) process.env.HEADLESS = 'true';
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 2: E2E/API TEST GENERATION
  // ═══════════════════════════════════════════════════════════════

  async _generateAutomationTests(workDir, techStack, codeAnalysis, apiDocumentation) {
    // Identify routes/endpoints to test
    const routes = codeAnalysis.surface?.routes || codeAnalysis.surface?.apiEndpoints || [];
    const endpoints = apiDocumentation?.apiEndpoints || [];

    if (routes.length === 0 && endpoints.length === 0) {
      logger.warn('[automation-pipeline] No routes/endpoints found for E2E/API test generation');
      return [];
    }

    logger.info(`[automation-pipeline] Found ${routes.length} routes and ${endpoints.length} API endpoints`);

    // Split into chunks (max 5 endpoints per chunk)
    const CHUNK_SIZE = 5;
    const testItems = [...routes, ...endpoints].slice(0, 50); // Cap at 50 items
    const chunks = [];
    for (let i = 0; i < testItems.length; i += CHUNK_SIZE) {
      chunks.push(testItems.slice(i, i + CHUNK_SIZE));
    }

    const totalChunks = Math.min(chunks.length, this.maxChunks);
    logger.info(`[automation-pipeline] Split into ${totalChunks} chunk(s) for generation`);

    const outputDir = path.join(workDir, 'generated-tests');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const allGeneratedFiles = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunk = chunks[i];
      logger.info(`[automation-pipeline] Generating chunk ${i + 1}/${totalChunks} (${chunk.length} items)...`);

      try {
        const files = await this._generateChunk(
          workDir, chunk, techStack, codeAnalysis, apiDocumentation, i + 1, totalChunks
        );

        // Write files
        for (const file of files) {
          const filePath = path.join(outputDir, path.basename(file.path));
          fs.writeFileSync(filePath, file.content, 'utf-8');
          allGeneratedFiles.push({ ...file, writtenPath: filePath });
        }

        logger.info(`[automation-pipeline] ✅ Chunk ${i + 1}: ${files.length} file(s) generated`);
      } catch (err) {
        logger.warn(`[automation-pipeline] Chunk ${i + 1} generation failed: ${err.message.slice(0, 200)}`);
      }
    }

    return allGeneratedFiles;
  }

  async _generateChunk(workDir, items, techStack, codeAnalysis, apiDocumentation, chunkIndex, totalChunks) {
    // Build context
    const itemsContext = items.map(item => ({
      name: item.name || item.path || item.method + ' ' + item.path,
      description: item.description || '',
      method: item.method,
      path: item.path,
      parameters: item.parameters || item.queryParams || []
    }));

    const systemPrompt = this.promptLoader.load('system-generate-tests', {
      language: techStack.language || 'TypeScript',
      framework: techStack.framework || 'Next.js',
      testRunner: 'Playwright',
      moduleSystem: 'CommonJS',
      fileExtension: 'spec.js',
      isUnitTest: false,
      chunkIndex,
      totalChunks
    });

    const userMessage = `Generate E2E/API Playwright tests for the following ${items.length} routes/endpoints.
Target: Maximum realistic coverage with proper error handling.

## Routes/Endpoints to Test:
${JSON.stringify(itemsContext, null, 2).slice(0, 5000)}

## API Documentation Context:
${JSON.stringify(apiDocumentation?.apiEndpoints?.slice(0, 10) || [], null, 2).slice(0, 4000)}

## Technology Stack:
- Framework: ${techStack.framework}
- Language: ${techStack.language}
- Database: ${techStack.database?.type || 'Unknown'}

## Key Business Logic:
${JSON.stringify(apiDocumentation?.businessLogic?.slice(0, 5) || [], null, 2).slice(0, 2000)}

## Generation Requirements:
- Use Playwright \`test\` from '@playwright/test'
- For API tests: use \`request\` context
- For E2E tests: use \`page\` context
- Include error cases: 404, 401, 400, 500
- Include edge cases: empty data, null values, boundary values
- Use realistic test data
- Add assertions for response status, headers, body
- Use \`test.describe()\` for grouping
`;

    const response = await this.codeGenProvider.generateTests(
      { context: userMessage, systemPrompt, items: itemsContext },
      'e2e',
      techStack
    );

    return this._parseTestGenerationResponse(response);
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 3: TEST VERIFICATION
  // ═══════════════════════════════════════════════════════════════

  async _verifyTests(workDir, generatedFiles, techStack) {
    if (generatedFiles.length === 0) return { ready: 0, fixed: 0 };

    let ready = 0;
    let fixed = 0;

    for (const file of generatedFiles) {
      if (!file.writtenPath || !fs.existsSync(file.writtenPath)) continue;

      // Syntax check
      const content = fs.readFileSync(file.writtenPath, 'utf-8');
      if (this._checkSyntax(content)) {
        ready++;
      } else {
        // Try basic fix
        let fixedContent = content;
        // Balance braces
        const openBraces = (fixedContent.match(/\{/g) || []).length;
        const closeBraces = (fixedContent.match(/\}/g) || []).length;
        if (openBraces > closeBraces) {
          fixedContent += '\n' + '}'.repeat(openBraces - closeBraces);
        }

        if (this._checkSyntax(fixedContent)) {
          fs.writeFileSync(file.writtenPath, fixedContent, 'utf-8');
          ready++;
          fixed++;
        }
      }
    }

    return { ready, fixed };
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 4: TEST EXECUTION
  // ═══════════════════════════════════════════════════════════════

  async _executeTests(workDir, appUrl) {
    const testDir = path.join(workDir, 'generated-tests');
    if (!fs.existsSync(testDir)) {
      logger.warn('[automation-pipeline] No generated-tests directory');
      return { passed: 0, failed: 0, total: 0, coverage: 0, exitCode: 1 };
    }

    try {
      logger.info(`[automation-pipeline] Running tests with app URL: ${appUrl || 'http://localhost:3000'}`);
      const results = await this.testRunner.constructor.runTests(workDir, {
        appUrl: appUrl || process.env.APP_URL || 'http://localhost:3000'
      });
      return results;
    } catch (err) {
      logger.error(`[automation-pipeline] Test execution error: ${err.message}`);
      return { passed: 0, failed: 0, total: 0, coverage: 0, exitCode: 1, errors: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 5: FIX FAILURES
  // ═══════════════════════════════════════════════════════════════

  async _fixAndRerun(workDir, executionResult, techStack, codeAnalysis, appUrl) {
    let result = executionResult;

    for (let iteration = 0; iteration < this.maxFixIterations; iteration++) {
      if (result.failed === 0) break;

      logger.info(`[automation-pipeline] Fix iteration ${iteration + 1}/${this.maxFixIterations}`);

      // Analyze failures
      const failedTests = (result.failures || []).slice(0, 10);
      if (failedTests.length === 0) break;

      // Generate fixes
      try {
        const fixes = await this._generateFixes(failedTests, workDir, codeAnalysis);

        if (!fixes || fixes.length === 0) {
          logger.info('[automation-pipeline] No fixes generated');
          break;
        }

        // Apply fixes
        let appliedCount = 0;
        for (const fix of fixes) {
          if (this._applyFix(fix, workDir)) appliedCount++;
        }

        if (appliedCount === 0) {
          logger.info('[automation-pipeline] No fixes could be applied');
          break;
        }

        logger.info(`[automation-pipeline] Applied ${appliedCount} fix(es). Re-running...`);

        // Re-run
        result = await this._executeTests(workDir, appUrl);

        if (result.failed === 0) {
          logger.info('[automation-pipeline] ✅ All tests passing!');
          break;
        }
      } catch (err) {
        logger.warn(`[automation-pipeline] Fix generation failed: ${err.message.slice(0, 200)}`);
        break;
      }
    }

    return result;
  }

  async _generateFixes(failedTests, workDir, codeAnalysis) {
    const systemPrompt = this.promptLoader.load('system-analyze-failures', {
      language: 'TypeScript',
      framework: 'Next.js',
      testRunner: 'Playwright'
    });

    const userMessage = JSON.stringify({
      testOutput: failedTests.map(t => t.error || t.message).join('\n').slice(0, 5000),
      failedTests: failedTests.slice(0, 5)
    });

    const response = await this.codeGenProvider.generateFix(
      { systemPrompt, context: userMessage },
      {}
    );

    return this._parseJsonResponse(response, { fixes: [] }).fixes || [];
  }

  _applyFix(fix, workDir) {
    if (!fix.file || !fix.originalCode || !fix.fixedCode) return false;

    const candidates = [
      path.join(workDir, fix.file),
      path.join(workDir, 'generated-tests', path.basename(fix.file))
    ];

    for (const filePath of candidates) {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes(fix.originalCode)) continue;

      const newContent = content.replace(fix.originalCode, fix.fixedCode);
      if (this._checkSyntax(newContent)) {
        fs.writeFileSync(filePath, newContent, 'utf-8');
        return true;
      }
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 6: REPORT GENERATION
  // ═══════════════════════════════════════════════════════════════

  async _generateReport(results, workDir) {
    const logDir = path.join(workDir, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(logDir, `automation-test-report-${timestamp}.json`);

    const report = {
      timestamp: new Date().toISOString(),
      total: results.total || 0,
      passed: results.passed || 0,
      failed: results.failed || 0,
      skipped: results.skipped || 0,
      coverage: results.coverage || 0,
      passRate: results.total ? `${Math.round(results.passed / results.total * 100)}%` : '0%',
      duration: results.duration || 0
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    logger.info(`[automation-pipeline] Report written: ${path.basename(reportPath)}`);

    return { reportPath, ...report };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  _isPackageAvailable(pkg, cwd) {
    try {
      require.resolve(pkg, { paths: [cwd, path.join(cwd, 'node_modules')] });
      return true;
    } catch {
      try { require.resolve(pkg); return true; } catch { return false; }
    }
  }

  _checkSyntax(content) {
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    return openBraces === closeBraces && openParens === closeParens;
  }

  _parseTestGenerationResponse(response) {
    const parsed = this._parseJsonResponse(response, { files: [] });
    if (Array.isArray(parsed)) return { files: parsed };
    if (parsed.files) return parsed;
    return { files: [] };
  }

  _parseJsonResponse(response, defaultValue) {
    if (!response) return defaultValue;
    if (typeof response === 'object' && !Array.isArray(response)) return response;

    const text = typeof response === 'string' ? response : JSON.stringify(response);

    try { return JSON.parse(text); } catch {}

    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]); } catch {}
    }

    return defaultValue;
  }
}

module.exports = AutomationTestPipeline;
