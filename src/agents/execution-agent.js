'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const BaseSubAgent = require('./base-sub-agent');
const UnitTestPipeline = require('../core/unit-test-pipeline');
const AutomationTestPipeline = require('../core/automation-test-pipeline');

/**
 * Execution Agent (Test Runner & Coverage) — Responsible for:
 * - Unit test execution with coverage measurement (via UnitTestPipeline)
 * - Automation (Playwright) test execution with coverage measurement
 * - Coverage report generation
 * - Detailed log generation per test file
 * - AI-powered failure analysis and test/app code fixes
 * - Iterates until coverage >= threshold or max iterations reached
 */
class ExecutionAgent extends BaseSubAgent {
  constructor(config, dependencies) {
    super('execution', config, dependencies);
    this.unitTestRunner = dependencies.unitTestRunner;
    this.testRunner = dependencies.testRunner;
    this.issueFixer = dependencies.issueFixer;
    this.appLauncher = dependencies.appLauncher;
    this.reportGenerator = dependencies.reportGenerator;
    this.repoManager = dependencies.repoManager;
    this.testCoverageScanner = dependencies.testCoverageScanner;

    // Initialize the new Unit Test Pipeline
    this.unitTestPipeline = new UnitTestPipeline(config, {
      aiProvider: dependencies.aiProvider,
      codeGenProvider: dependencies.codeGenProvider,
      unitTestRunner: dependencies.unitTestRunner
    });

    // Initialize the new Automation Test Pipeline
    this.automationTestPipeline = new AutomationTestPipeline(config, {
      aiProvider: dependencies.aiProvider,
      codeGenProvider: dependencies.codeGenProvider,
      testRunner: dependencies.testRunner,
      issueFixer: dependencies.issueFixer
    });
  }

  /**
   * Run a single iteration of the execution agent.
   * Each iteration: run tests → measure coverage → if below threshold, fix and re-run.
   * 
   * On iteration 0: Uses the full UnitTestPipeline (API docs → generate → verify → run → fix).
   * On iteration 1+: Re-runs existing tests and applies fixes.
   */
  async _runIteration(context, iteration, previousResult = null) {
    const { workDir, techStack, codeAnalysis, appUrl, existingTests } = context;
    const artifacts = [];
    const issues = [];

    // ── Phase 1: Unit Test Execution ────────────────────────────
    logger.info(`[execution] Phase 1: Unit Test Execution (iteration ${iteration + 1})`);
    let unitTestResults;

    if (iteration === 0) {
      // First iteration: use the full Unit Test Pipeline
      // (generates API docs, creates tests in chunks, verifies, runs, fixes)
      try {
        logger.info('[execution] Using UnitTestPipeline (API docs → generate → verify → run → fix)');
        const pipelineResult = await this.unitTestPipeline.execute({
          workDir,
          techStack,
          codeAnalysis,
          existingTests
        });
        unitTestResults = {
          framework: pipelineResult.framework || 'jest',
          passed: pipelineResult.passed || 0,
          failed: pipelineResult.failed || 0,
          total: pipelineResult.total || 0,
          skipped: pipelineResult.skipped || 0,
          coverage: pipelineResult.coverage || 0,
          exitCode: pipelineResult.exitCode,
          errors: pipelineResult.errors || '',
          rawOutput: pipelineResult.rawOutput || ''
        };
        if (pipelineResult.report) {
          artifacts.push({ type: 'unit-test-report', path: pipelineResult.report.reportPath, description: 'Unit test pipeline report' });
        }
      } catch (err) {
        logger.error(`[execution] UnitTestPipeline failed: ${err.message}`);
        logger.info('[execution] Falling back to standard unit test runner...');
        unitTestResults = await this._runUnitTests(context, previousResult);
      }
    } else {
      // Subsequent iterations: just re-run tests (fixes already applied)
      unitTestResults = await this._runUnitTests(context, previousResult);
    }

    // ── Phase 2: Automation Test Execution ──────────────────────
    logger.info(`[execution] Phase 2: Automation Test Execution (iteration ${iteration + 1})`);
    let automationTestResults;

    if (iteration === 0) {
      // Full pipeline on first iteration (generation + verification + execution + fixing)
      try {
        logger.info('[execution] Using AutomationTestPipeline for comprehensive E2E/API test coverage...');
        const pipelineResult = await this.automationTestPipeline.execute({
          workDir,
          techStack,
          codeAnalysis,
          apiDocumentation: codeAnalysis.apiDocumentation || {},
          appUrl: appUrl || process.env.APP_URL || 'http://localhost:3000'
        });
        automationTestResults = {
          framework: 'playwright',
          passed: pipelineResult.passed || 0,
          failed: pipelineResult.failed || 0,
          total: pipelineResult.total || 0,
          skipped: pipelineResult.skipped || 0,
          coverage: pipelineResult.coverage || 0,
          exitCode: pipelineResult.exitCode,
          errors: pipelineResult.errors || '',
          generatedTests: pipelineResult.generatedFiles || 0
        };
        if (pipelineResult.report) {
          artifacts.push({ type: 'automation-test-report', path: pipelineResult.report.reportPath, description: 'Automation test pipeline report' });
        }
      } catch (err) {
        logger.error(`[execution] AutomationTestPipeline failed: ${err.message}`);
        logger.info('[execution] Falling back to standard automation test runner...');
        automationTestResults = await this._runAutomationTests(context, previousResult);
      }
    } else {
      // Subsequent iterations: just re-run tests (fixes already applied)
      automationTestResults = await this._runAutomationTests(context, previousResult);
    }

    // ── Phase 3: Coverage Assessment ────────────────────────────
    const unitCoverage = this._extractCoverage(unitTestResults, 'unit');
    const automationCoverage = this._extractCoverage(automationTestResults, 'automation');
    const combinedCoverage = this._calculateCombinedCoverage(unitCoverage, automationCoverage, iteration);

    logger.info(`[execution] Coverage Report:`);
    logger.info(`   Unit Test Coverage:       ${unitCoverage}%`);
    logger.info(`   Automation Test Coverage: ${automationCoverage}%`);
    logger.info(`   Combined Coverage:        ${combinedCoverage}%`);
    logger.info(`   Target:                   ${this.coverageThreshold}%`);

    // ── Phase 4: Fix Failures (if any) ──────────────────────────
    let fixesApplied = 0;
    if (iteration < this.maxIterations - 1) {
      // Fix unit test failures
      if (unitTestResults && unitTestResults.failed > 0) {
        logger.info(`[execution] Fixing ${unitTestResults.failed} unit test failure(s)...`);
        const unitFixes = await this._fixFailures(workDir, unitTestResults, codeAnalysis, 'unit');
        fixesApplied += unitFixes;
      }

      // Fix automation test failures
      if (automationTestResults && automationTestResults.failed > 0) {
        logger.info(`[execution] Fixing ${automationTestResults.failed} automation test failure(s)...`);
        const autoFixes = await this._fixFailures(workDir, automationTestResults, codeAnalysis, 'automation');
        fixesApplied += autoFixes;
      }
    }

    // ── Phase 5: Report & Log Generation ────────────────────────
    logger.info('[execution] Phase 5: Report & Log Generation');
    const reportResult = await this._generateReports(workDir, unitTestResults, automationTestResults, context);
    if (reportResult) {
      artifacts.push({ type: 'report', path: reportResult.reportPath, description: 'Test execution report' });
    }

    return {
      status: combinedCoverage >= this.coverageThreshold ? 'success' : 'below-threshold',
      complete: combinedCoverage >= this.coverageThreshold && 
               (unitTestResults?.failed || 0) === 0 && 
               (automationTestResults?.failed || 0) === 0,
      coverage: combinedCoverage,
      unitCoverage,
      automationCoverage,
      unitTestResults,
      automationTestResults,
      fixesApplied,
      artifacts,
      issues
    };
  }

  /**
   * Run unit tests with coverage.
   * Always runs existing repo tests for coverage assessment — never skips them.
   * Detects framework per-file (Jest vs Playwright) before running.
   */
  async _runUnitTests(context, previousResult) {
    const { workDir, techStack, testTypes } = context;
    let { existingTests } = context;
    const UnitTestRunner = this.unitTestRunner;

    try {
      // If existingTests not available (e.g., execution-only mode), scan the repo now
      if (!existingTests && this.testCoverageScanner) {
        logger.info('[execution] No existing test scan available — scanning repo for tests...');
        existingTests = await this.testCoverageScanner.scanExistingTests(workDir, { includeGenerated: true });
        context.existingTests = existingTests;
      }

      // Collect test directories (includes both repo tests and generated tests)
      const testDirs = this._collectUnitTestDirs(workDir, existingTests);

      if (testDirs.length === 0) {
        logger.info('[execution] No unit test directories found');
        return { framework: 'jest', passed: 0, failed: 0, total: 0, skipped: 0, coverage: null };
      }

      logger.info(`[execution] Running unit tests from ${testDirs.length} directory(ies)`);
      
      // Detect existing test frameworks from spec file content
      const existingTestFrameworks = new Set();
      if (existingTests) {
        Object.values(existingTests).forEach(tests => {
          tests.forEach(test => {
            if (test.framework && !['unknown', 'playwright', 'cypress'].includes(test.framework)) {
              existingTestFrameworks.add(test.framework);
            }
          });
        });
      }

      // Also detect framework by reading spec files in test directories
      const detectedFromFiles = this._detectFrameworkFromTestFiles(testDirs);
      for (const fw of detectedFromFiles) {
        existingTestFrameworks.add(fw);
      }

      if (existingTestFrameworks.size > 0) {
        logger.info(`[execution] Detected test framework(s): ${[...existingTestFrameworks].join(', ')}`);
      }

      const results = await UnitTestRunner.runTests(workDir, testDirs, {
        detectedFrameworks: [...existingTestFrameworks]
      });

      // Write results to log
      UnitTestRunner.writeResultsToLog(results, workDir);

      return results;
    } catch (err) {
      logger.error(`[execution] Unit test execution failed: ${err.message}`);
      return { framework: 'unknown', passed: 0, failed: 1, total: 1, error: err.message, coverage: null };
    }
  }

  /**
   * Detect test framework by reading imports/requires from test files in directories.
   * Returns a Set of detected framework names (e.g., 'jest', 'mocha', 'vitest').
   */
  _detectFrameworkFromTestFiles(testDirs) {
    const detected = new Set();
    const maxFilesToScan = 20; // Limit scanning for performance
    let scanned = 0;

    for (const dir of testDirs) {
      if (scanned >= maxFilesToScan) break;
      if (!fs.existsSync(dir)) continue;

      const files = this._getTestFilesFlat(dir, 3); // max depth 3
      for (const file of files) {
        if (scanned >= maxFilesToScan) break;
        try {
          const content = fs.readFileSync(file, 'utf-8').slice(0, 1000);

          // Detect Jest (most common)
          if (
            content.includes("from 'jest'") ||
            content.includes("from \"jest\"") ||
            content.includes("require('jest')") ||
            content.includes("@jest/globals") ||
            content.includes('describe(') && content.includes('expect(') ||
            content.includes('it(') && content.includes('expect(') ||
            content.includes('test(') && content.includes('expect(')
          ) {
            detected.add('jest');
          }

          // Detect Mocha
          if (
            content.includes("from 'mocha'") ||
            content.includes("require('mocha')") ||
            content.includes("from 'chai'") ||
            content.includes("require('chai')") ||
            content.includes('.should.') ||
            content.includes('assert.') && content.includes("require('assert')")
          ) {
            detected.add('mocha');
          }

          // Detect Vitest
          if (
            content.includes("from 'vitest'") ||
            content.includes("import { test") && content.includes("vitest")
          ) {
            detected.add('vitest');
          }

          scanned++;
        } catch { /* skip unreadable files */ }
      }
    }

    return detected;
  }

  /**
   * Get test files (flat list) from a directory up to maxDepth.
   */
  _getTestFilesFlat(dir, maxDepth, depth = 0) {
    const files = [];
    if (depth > maxDepth) return files;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...this._getTestFilesFlat(fullPath, maxDepth, depth + 1));
        } else if (
          entry.name.endsWith('.test.js') || entry.name.endsWith('.test.ts') ||
          entry.name.endsWith('.spec.js') || entry.name.endsWith('.spec.ts')
        ) {
          files.push(fullPath);
        }
      }
    } catch {}
    return files;
  }

  /**
   * Run automation (Playwright) tests with coverage.
   * Checks both generated-tests/ and existing repo Playwright tests.
   */
  async _runAutomationTests(context, previousResult) {
    const { workDir, appUrl } = context;
    const TestRunner = this.testRunner;

    // Check generated-tests for Playwright config
    const generatedTestDir = path.join(workDir, 'generated-tests');
    const hasGeneratedPlaywright = fs.existsSync(path.join(generatedTestDir, 'playwright.config.js'));

    // Also check repo root for existing Playwright config
    const repoPlaywrightConfig = this._findRepoPlaywrightConfig(workDir);

    if (!hasGeneratedPlaywright && !repoPlaywrightConfig) {
      logger.info('[execution] No Playwright config found — skipping automation tests');
      return { passed: 0, failed: 0, total: 0, skipped: 0, coverage: null };
    }

    try {
      let results = { passed: 0, failed: 0, total: 0, skipped: 0, coverage: null };

      // Run generated Playwright tests
      if (hasGeneratedPlaywright) {
        logger.info(`[execution] Running generated Playwright tests (app URL: ${appUrl || 'not set'})`);
        const genResults = await TestRunner.runTests(workDir, { appUrl });
        results = genResults;
      }

      // Run existing repo Playwright tests (if found and separate from generated)
      if (repoPlaywrightConfig && repoPlaywrightConfig !== path.join(generatedTestDir, 'playwright.config.js')) {
        logger.info(`[execution] Running existing repo Playwright tests (config: ${path.relative(workDir, repoPlaywrightConfig)})`);
        const repoResults = await this._runRepoPlaywrightTests(workDir, repoPlaywrightConfig, appUrl);
        // Merge results
        results = {
          passed: results.passed + repoResults.passed,
          failed: results.failed + repoResults.failed,
          total: results.total + repoResults.total,
          skipped: results.skipped + repoResults.skipped,
          duration: (results.duration || 0) + (repoResults.duration || 0),
          exitCode: results.exitCode || repoResults.exitCode,
          failures: [...(results.failures || []), ...(repoResults.failures || [])],
          allTests: [...(results.allTests || []), ...(repoResults.allTests || [])],
          coverage: results.coverage
        };
      }

      return results;
    } catch (err) {
      logger.error(`[execution] Automation test execution failed: ${err.message}`);
      return { passed: 0, failed: 1, total: 1, error: err.message, coverage: null };
    }
  }

  /**
   * Find Playwright config in the repo (excluding generated-tests/).
   * Searches common locations: root, e2e/, tests/, test/.
   */
  _findRepoPlaywrightConfig(workDir) {
    const candidates = [
      path.join(workDir, 'playwright.config.js'),
      path.join(workDir, 'playwright.config.ts'),
      path.join(workDir, 'e2e', 'playwright.config.js'),
      path.join(workDir, 'e2e', 'playwright.config.ts'),
      path.join(workDir, 'tests', 'playwright.config.js'),
      path.join(workDir, 'tests', 'playwright.config.ts'),
      path.join(workDir, 'test', 'playwright.config.js'),
      path.join(workDir, 'test', 'playwright.config.ts')
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  /**
   * Run existing repo Playwright tests using their own config.
   */
  async _runRepoPlaywrightTests(workDir, configPath, appUrl) {
    const { spawn } = require('child_process');
    const configDir = path.dirname(configPath);
    const configFile = path.basename(configPath);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';

      const args = [
        'playwright', 'test',
        '--config', configFile,
        '--reporter', 'json'
      ];

      const proc = spawn('npx', args, {
        cwd: configDir,
        shell: true,
        stdio: 'pipe',
        timeout: 10 * 60 * 1000,
        env: {
          ...process.env,
          APP_URL: appUrl || process.env.APP_URL || 'http://localhost:3000',
          CI: 'true',
          PLAYWRIGHT_HEADLESS: '1'
        }
      });

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        logger.info(`Repo Playwright tests exited with code ${code}`);
        let jsonResults = null;
        try {
          jsonResults = JSON.parse(stdout);
        } catch {
          // Try extracting JSON from mixed output
          const jsonMatch = stdout.match(/^\{[\s\S]*\}$/m);
          if (jsonMatch) {
            try { jsonResults = JSON.parse(jsonMatch[0]); } catch {}
          }
        }

        const TestRunnerClass = require('../core/test-runner');
        resolve(TestRunnerClass.parseResults(jsonResults, code));
      });

      proc.on('error', (err) => {
        logger.warn(`Failed to run repo Playwright tests: ${err.message}`);
        resolve({ passed: 0, failed: 0, total: 0, skipped: 0 });
      });
    });
  }

  /**
   * Fix test failures using AI.
   */
  async _fixFailures(workDir, testResults, codeAnalysis, testType) {
    if (!this.issueFixer) return 0;

    try {
      const failureAnalysis = await this.issueFixer.analyzeFailures(testResults, codeAnalysis, workDir);
      const fixResult = await this.issueFixer.generateAndApplyFixes(failureAnalysis, workDir, {
        previousFailCount: testResults.failed
      });

      if (fixResult.applied && fixResult.applied.length > 0) {
        logger.info(`[execution] Applied ${fixResult.applied.length} fix(es) for ${testType} tests`);
        return fixResult.applied.length;
      }
    } catch (err) {
      logger.warn(`[execution] Fix generation failed for ${testType}: ${err.message}`);
    }

    return 0;
  }

  /**
   * Generate reports and logs.
   */
  async _generateReports(workDir, unitTestResults, automationTestResults, context) {
    if (!this.reportGenerator) return null;

    try {
      const reportData = {
        runId: context.runId || 'manual',
        repository: context.repoPath || workDir,
        branch: context.branch || 'main',
        testTypes: context.testTypes,
        codeAnalysis: context.codeAnalysis,
        appDocumentation: context.appDocumentation || null,
        testResults: automationTestResults,
        testResultsWorkDir: workDir,
        unitTestResults: unitTestResults ? {
          framework: unitTestResults.framework,
          total: unitTestResults.total,
          passed: unitTestResults.passed,
          failed: unitTestResults.failed,
          skipped: unitTestResults.skipped,
          duration: unitTestResults.duration,
          coverage: unitTestResults.coverage,
          failures: unitTestResults.failures || []
        } : null,
        duration: Date.now() - this.startTime
      };

      const reportInfo = await this.reportGenerator.generateComprehensiveReport(workDir, reportData);
      logger.info(`[execution] Report generated: ${reportInfo.reportPath}`);
      return reportInfo;
    } catch (err) {
      logger.warn(`[execution] Report generation failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Extract coverage percentage from test results.
   * Unit tests: use Jest/Mocha coverage from tool
   * Automation tests: use pass rate (passed/total) as proxy for coverage
   */
  _extractCoverage(results, type) {
    if (!results) {
      logger.warn(`[execution] \u26a0\ufe0f  No ${type} test results available`);
      return 0;
    }

    // Unit tests: use Jest/Mocha coverage
    if (type === 'unit' && results.coverage) {
      const cov = results.coverage;
      const coverage = typeof cov === 'number' ? cov : (cov.statements || cov.lines || 0);
      logger.info(`[execution] Unit test coverage: ${coverage}% (${results.passed}/${results.total} passed)`);
      return coverage;
    }

    // Automation tests: use pass rate as proxy for coverage
    if (type === 'automation') {
      if (results.total === 0) {
        logger.warn('[execution] \u274c Automation: No tests found (total=0)');
        logger.debug(`  Details: Failed=${results.failed}, Passed=${results.passed}, Skipped=${results.skipped}`);
        return 0;
      }
      const coverage = Math.round((results.passed / results.total) * 100);
      logger.info(`[execution] Automation test pass rate: ${coverage}% (${results.passed}/${results.total} passed, ${results.failed} failed)`);
      return coverage;
    }

    logger.warn(`[execution] \u26a0\ufe0f  Unable to calculate ${type} coverage`);
    return 0;
  }

  /**
   * Calculate combined coverage from unit and automation.
   * Uses weighted average: 60% unit coverage + 40% automation pass rate.
   */
  _calculateCombinedCoverage(unitCoverage, automationCoverage, iteration = 0) {
    let combined = 0;
    
    if (unitCoverage === 0 && automationCoverage === 0) {
      logger.warn('[execution] \u26a0\ufe0f  Both unit and automation coverage are 0%');
      combined = 0;
    } else if (unitCoverage === 0) {
      combined = automationCoverage;
      logger.debug('[execution] Using automation coverage only (unit=0)');
    } else if (automationCoverage === 0) {
      combined = unitCoverage;
      logger.debug('[execution] Using unit coverage only (automation=0)');
    } else {
      // Weighted: 60% unit coverage, 40% automation pass rate
      combined = Math.round(unitCoverage * 0.6 + automationCoverage * 0.4);
      logger.debug(`[execution] Combined coverage calculation: ${unitCoverage}% * 0.6 + ${automationCoverage}% * 0.4 = ${combined}%`);
    }
    
    return combined;
  }

  /**
   * Collect unit test directories from workspace.
   * Includes both .test.js and .spec.js files (framework detected per-file).
   */
  _collectUnitTestDirs(workDir, existingTests) {
    const testDirs = [];
    const projectTestDirs = ['__tests__', 'tests', 'test', 'spec'];
    const frontendDirPatterns = ['components', 'pages', 'dashboard', 'ui', 'views', 'layout', 'widgets', 'hooks', 'features', 'screens'];

    // Generated tests
    const generatedTestDir = path.join(workDir, 'generated-tests', 'tests');
    if (fs.existsSync(generatedTestDir)) {
      const hasUnitTestFiles = this._hasFilesMatching(generatedTestDir, /\.(test|spec)\.(js|ts)$/);
      if (hasUnitTestFiles) testDirs.push(generatedTestDir);
    }

    // Project test directories
    const searchRoots = [workDir];
    for (const sub of ['src', 'app', 'lib', 'packages']) {
      const subPath = path.join(workDir, sub);
      if (fs.existsSync(subPath)) searchRoots.push(subPath);
    }

    for (const root of searchRoots) {
      for (const dir of projectTestDirs) {
        const candidate = path.join(root, dir);
        if (fs.existsSync(candidate) && !testDirs.includes(candidate)) {
          const relativePath = path.relative(workDir, candidate).toLowerCase().replace(/\\/g, '/');
          const isFrontendTest = frontendDirPatterns.some(p => relativePath.includes(`/${p}/`) || relativePath.startsWith(`${p}/`));
          if (!isFrontendTest) testDirs.push(candidate);
        }
      }
    }

    // Also include directories from existingTests that aren't already covered
    if (existingTests) {
      const existingDirs = new Set();
      for (const type of ['unit', 'integration']) {
        const tests = existingTests[type] || [];
        for (const test of tests) {
          if (test.file) {
            const testFileDir = path.dirname(path.join(workDir, test.file));
            if (fs.existsSync(testFileDir) && !testDirs.includes(testFileDir)) {
              existingDirs.add(testFileDir);
            }
          }
        }
      }
      // Add unique parent directories (avoid too many fine-grained dirs)
      for (const dir of existingDirs) {
        if (!testDirs.some(d => dir.startsWith(d))) {
          testDirs.push(dir);
        }
      }
    }

    return testDirs;
  }

  /**
   * Check if directory contains files matching a pattern (recursive).
   */
  _hasFilesMatching(dir, pattern, depth = 0) {
    if (depth > 5) return false;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules') continue;
        if (entry.isFile() && pattern.test(entry.name)) return true;
        if (entry.isDirectory()) {
          if (this._hasFilesMatching(path.join(dir, entry.name), pattern, depth + 1)) return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }

  /**
   * Override: execution agent uses actual coverage numbers.
   */
  _isCoverageMet(result) {
    if (!result || result.coverage === undefined) return false;
    return result.coverage >= this.coverageThreshold;
  }
}

module.exports = ExecutionAgent;
