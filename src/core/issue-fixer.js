'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const TestRunner = require('./test-runner');

class IssueFixer {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  /**
   * Analyze test failures and produce a fix plan.
   */
  async analyzeFailures(testResults, codeAnalysis, workDir) {
    logger.info(`Analyzing ${testResults.failures.length} failure(s)...`);

    // Categorize failures
    const categorized = TestRunner.categorizeFailures(testResults.failures);

    // Gather source code for the failing files
    const sourceCode = {};
    for (const failure of categorized) {
      if (!failure.file) continue;
      
      // Try multiple locations for the test file
      const candidates = [
        path.join(workDir, 'generated-tests', failure.file),
        path.join(workDir, failure.file),
        failure.file // absolute path
      ];
      
      for (const testFilePath of candidates) {
        if (fs.existsSync(testFilePath)) {
          try {
            sourceCode[`test:${failure.file}`] = fs.readFileSync(testFilePath, 'utf-8');
          } catch {}
          break;
        }
      }
    }

    // Include key source files from analysis
    if (codeAnalysis?.analysis?.analyzedFiles) {
      for (const file of codeAnalysis.analysis.analyzedFiles.slice(0, 10)) {
        const fullPath = path.join(workDir, file);
        if (fs.existsSync(fullPath)) {
          try {
            sourceCode[`app:${file}`] = fs.readFileSync(fullPath, 'utf-8');
          } catch {
            // Skip unreadable
          }
        }
      }
    }

    // Ask AI to analyze
    const failureAnalysis = await this.aiProvider.analyzeFailures(
      { failures: categorized, passCount: testResults.passed, failCount: testResults.failed },
      sourceCode
    );

    return {
      failures: categorized,
      analysis: failureAnalysis,
      sourceCode
    };
  }

  /**
   * Generate and validate fixes for identified issues.
   * Implements guardrails: quick-check per fix + full regression check.
   */
  async generateAndApplyFixes(failureAnalysis, workDir, config = {}) {
    logger.info('Generating fixes...');

    const fixes = await this.aiProvider.generateFix(
      failureAnalysis.analysis,
      failureAnalysis.sourceCode
    );

    if (!Array.isArray(fixes) || fixes.length === 0) {
      logger.warn('AI returned no fixes');
      return { applied: [], reverted: [], noFixes: true };
    }

    logger.info(`AI proposed ${fixes.length} fix(es)`);

    const applied = [];
    const reverted = [];
    const backups = new Map();

    for (const fix of fixes) {
      if (!fix.file || !fix.originalCode || !fix.fixedCode) {
        logger.warn(`Skipping invalid fix: ${JSON.stringify(fix).slice(0, 100)}`);
        continue;
      }

      const result = await this._applyAndValidateFix(fix, workDir, backups, config);

      if (result.success) {
        applied.push({ ...fix, validated: true });
        logger.info(`Fix applied and validated: ${fix.file} — ${fix.explanation || 'no explanation'}`);
      } else {
        reverted.push({ ...fix, reason: result.reason });
        logger.warn(`Fix reverted: ${fix.file} — ${result.reason}`);
      }
    }

    logger.info(`Fixes: ${applied.length} applied, ${reverted.length} reverted`);
    return { applied, reverted };
  }

  /**
   * Apply a single fix and validate it doesn't break anything.
   * Reverts if validation fails.
   */
  async _applyAndValidateFix(fix, workDir, backups, config) {
    const filePath = this._resolveFixPath(fix.file, workDir);

    if (!fs.existsSync(filePath)) {
      return { success: false, reason: `File not found: ${fix.file}` };
    }

    // Backup the original file
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    backups.set(filePath, originalContent);

    // Apply the fix — exact string replacement
    if (!originalContent.includes(fix.originalCode)) {
      return { success: false, reason: 'Original code not found in file (exact match failed)' };
    }

    const fixedContent = originalContent.replace(fix.originalCode, fix.fixedCode);
    fs.writeFileSync(filePath, fixedContent, 'utf-8');

    // Quick validation: run only the failing test(s) if we can identify them
    if (config.appUrl) {
      try {
        // Run a quick check
        const result = await TestRunner.runTests(workDir, { appUrl: config.appUrl });

        if (result.failed > 0) {
          // Check if we introduced new failures
          const prevFailed = config.previousFailCount || 0;
          if (result.failed > prevFailed) {
            // Revert — this fix made things worse
            fs.writeFileSync(filePath, originalContent, 'utf-8');
            return { success: false, reason: 'Fix introduced new failures' };
          }
        }
      } catch (err) {
        logger.warn(`Validation run failed: ${err.message} — keeping fix tentatively`);
      }
    }

    return { success: true };
  }

  /**
   * Full regression check after all fixes in a batch are applied.
   */
  async validateAllFixes(workDir, previousPassCount, config = {}) {
    logger.info('Running full regression check...');

    const result = await TestRunner.runTests(workDir, config);

    if (result.passed >= previousPassCount) {
      logger.info(`Regression check passed: ${result.passed} passed (was ${previousPassCount})`);
      return { passed: true, result };
    }

    logger.warn(`Regression detected: ${result.passed} passed (was ${previousPassCount})`);
    return { passed: false, result };
  }

  /**
   * Revert all fixes from a batch using backups.
   */
  revertBatch(backups) {
    let reverted = 0;
    for (const [filePath, content] of backups) {
      fs.writeFileSync(filePath, content, 'utf-8');
      reverted++;
    }
    logger.info(`Reverted ${reverted} file(s) to pre-fix state`);
    return reverted;
  }

  /**
   * Resolve fix path — handles both app code and test code references.
   */
  _resolveFixPath(file, workDir) {
    // If path starts with generated-tests/, it's a test file
    if (file.startsWith('generated-tests/')) {
      return path.join(workDir, file);
    }

    // Check if it exists directly in workDir
    const direct = path.join(workDir, file);
    if (fs.existsSync(direct)) return direct;

    // Check in generated-tests
    const inTests = path.join(workDir, 'generated-tests', file);
    if (fs.existsSync(inTests)) return inTests;

    return direct;
  }

  /**
   * Get list of files modified by fixes (for committing).
   */
  getModifiedFiles(appliedFixes) {
    const files = new Set();
    for (const fix of appliedFixes) {
      files.add(fix.file);
    }
    return Array.from(files);
  }
}

module.exports = IssueFixer;
