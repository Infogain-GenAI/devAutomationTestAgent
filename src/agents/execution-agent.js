'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const BaseSubAgent = require('./base-sub-agent');

/**
 * Execution Agent (Test Runner & Coverage) — Responsible for:
 * - Unit test execution with coverage measurement
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
  }

  /**
   * Run a single iteration of the execution agent.
   * Each iteration: run tests → measure coverage → if below threshold, fix and re-run.
   */
  async _runIteration(context, iteration, previousResult = null) {
    const { workDir, techStack, codeAnalysis, appUrl, existingTests } = context;
    const artifacts = [];
    const issues = [];

    // ── Phase 1: Unit Test Execution ────────────────────────────
    logger.info(`[execution] Phase 1: Unit Test Execution (iteration ${iteration + 1})`);
    let unitTestResults = await this._runUnitTests(context, previousResult);

    // ── Phase 2: Automation Test Execution ──────────────────────
    logger.info(`[execution] Phase 2: Automation Test Execution (iteration ${iteration + 1})`);
    let automationTestResults = await this._runAutomationTests(context, previousResult);

    // ── Phase 3: Coverage Assessment ────────────────────────────
    const unitCoverage = this._extractCoverage(unitTestResults, 'unit');
    const automationCoverage = this._extractCoverage(automationTestResults, 'automation');
    const combinedCoverage = this._calculateCombinedCoverage(unitCoverage, automationCoverage);

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
   */
  async _runUnitTests(context, previousResult) {
    const { workDir, techStack, existingTests, testTypes } = context;
    const UnitTestRunner = this.unitTestRunner;
    
    const hasUnitTests = testTypes.some(t => ['unit', 'integration'].includes(t));
    if (!hasUnitTests) {
      return { framework: 'none', passed: 0, failed: 0, total: 0, skipped: 0, coverage: null };
    }

    try {
      // Collect test directories
      const testDirs = this._collectUnitTestDirs(workDir, existingTests);

      if (testDirs.length === 0) {
        logger.info('[execution] No unit test directories found');
        return { framework: 'jest', passed: 0, failed: 0, total: 0, skipped: 0, coverage: null };
      }

      logger.info(`[execution] Running unit tests from ${testDirs.length} directory(ies)`);
      
      // Detect existing test frameworks
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
   * Run automation (Playwright) tests with coverage.
   */
  async _runAutomationTests(context, previousResult) {
    const { workDir, appUrl } = context;
    const TestRunner = this.testRunner;

    const generatedTestDir = path.join(workDir, 'generated-tests');
    const hasPlaywrightConfig = fs.existsSync(path.join(generatedTestDir, 'playwright.config.js'));

    if (!hasPlaywrightConfig) {
      logger.info('[execution] No Playwright config found — skipping automation tests');
      return { passed: 0, failed: 0, total: 0, skipped: 0, coverage: null };
    }

    try {
      logger.info(`[execution] Running Playwright automation tests (app URL: ${appUrl || 'not set'})`);
      const results = await TestRunner.runTests(workDir, { appUrl });
      return results;
    } catch (err) {
      logger.error(`[execution] Automation test execution failed: ${err.message}`);
      return { passed: 0, failed: 1, total: 1, error: err.message, coverage: null };
    }
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
   */
  _extractCoverage(results, type) {
    if (!results) return 0;

    // Unit tests: use Jest/Mocha coverage
    if (type === 'unit' && results.coverage) {
      const cov = results.coverage;
      return typeof cov === 'number' ? cov : (cov.statements || cov.lines || 0);
    }

    // Automation tests: use pass rate as proxy for coverage
    if (type === 'automation') {
      if (results.total === 0) return 0;
      return Math.round((results.passed / results.total) * 100);
    }

    return 0;
  }

  /**
   * Calculate combined coverage from unit and automation.
   * Uses weighted average: unit coverage (from tool) + automation pass rate.
   */
  _calculateCombinedCoverage(unitCoverage, automationCoverage) {
    if (unitCoverage === 0 && automationCoverage === 0) return 0;
    if (unitCoverage === 0) return automationCoverage;
    if (automationCoverage === 0) return unitCoverage;
    // Weighted: 60% unit coverage, 40% automation pass rate
    return Math.round(unitCoverage * 0.6 + automationCoverage * 0.4);
  }

  /**
   * Collect unit test directories from workspace.
   */
  _collectUnitTestDirs(workDir, existingTests) {
    const testDirs = [];
    const projectTestDirs = ['__tests__', 'tests', 'test', 'spec'];
    const frontendDirPatterns = ['components', 'pages', 'dashboard', 'ui', 'views', 'layout', 'widgets', 'hooks', 'features', 'screens'];

    // Generated tests
    const generatedTestDir = path.join(workDir, 'generated-tests', 'tests');
    if (fs.existsSync(generatedTestDir)) {
      const hasUnitTestFiles = this._hasFilesMatching(generatedTestDir, /\.test\.(js|ts)$/);
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
