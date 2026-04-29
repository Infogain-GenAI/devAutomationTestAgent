'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const TEST_TIMEOUT = 5 * 60 * 1000; // 5 minutes per test run

class TestRunner {
  /**
   * Run Playwright tests and return structured results.
   */
  static async runTests(workDir, config = {}) {
    const testDir = path.join(workDir, 'generated-tests');
    const resultsDir = path.join(workDir, 'test-results');
    const resultsFile = path.join(resultsDir, 'results.json');

    fs.mkdirSync(resultsDir, { recursive: true });

    if (!fs.existsSync(testDir)) {
      throw new Error(`Test directory does not exist: ${testDir}`);
    }

    const configFile = path.join(testDir, 'playwright.config.js');
    if (!fs.existsSync(configFile)) {
      throw new Error(`Playwright config not found: ${configFile}`);
    }

    logger.info(`Running Playwright tests in ${testDir}`);

    const args = [
      'playwright', 'test',
      '--config', configFile,
      '--reporter', 'json'
    ];

    if (config.grep) {
      args.push('--grep', config.grep);
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('npx', args, {
        cwd: workDir,
        shell: true,
        stdio: 'pipe',
        timeout: TEST_TIMEOUT,
        env: {
          ...process.env,
          APP_URL: config.appUrl || process.env.APP_URL || 'http://localhost:3000',
          CI: 'true'
        }
      });

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        logger.info(`Playwright exited with code ${code}`);

        // Try to parse JSON results
        let jsonResults = null;
        if (fs.existsSync(resultsFile)) {
          try {
            jsonResults = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
          } catch {
            logger.warn('Failed to parse JSON results file');
          }
        }

        // If no JSON file, try parsing stdout
        if (!jsonResults) {
          try {
            jsonResults = JSON.parse(stdout);
          } catch {
            logger.warn('Failed to parse stdout as JSON');
          }
        }

        const parsed = TestRunner.parseResults(jsonResults, code);
        resolve(parsed);
      });

      proc.on('error', (err) => {
        logger.error(`Failed to spawn Playwright: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Parse Playwright JSON reporter output into a structured result.
   */
  static parseResults(jsonReport, exitCode) {
    if (!jsonReport) {
      return {
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        exitCode,
        failures: [],
        allTests: []
      };
    }

    const suites = jsonReport.suites || [];
    const allTests = [];
    const failures = [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let totalDuration = 0;

    function processSuite(suite) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          for (const result of test.results || []) {
            const testInfo = {
              testName: spec.title,
              file: spec.file || suite.file,
              status: result.status,
              duration: result.duration || 0,
              error: null,
              stackTrace: null
            };

            totalDuration += testInfo.duration;

            if (result.status === 'passed' || result.status === 'expected') {
              passed++;
              testInfo.status = 'passed';
            } else if (result.status === 'skipped') {
              skipped++;
            } else {
              failed++;
              testInfo.status = 'failed';

              // Extract error information
              if (result.error) {
                testInfo.error = result.error.message || String(result.error);
                testInfo.stackTrace = result.error.stack || '';
              }
              if (result.errors && result.errors.length > 0) {
                testInfo.error = result.errors[0].message || '';
                testInfo.stackTrace = result.errors[0].stack || '';
              }

              failures.push({
                testName: testInfo.testName,
                file: testInfo.file,
                error: testInfo.error,
                stackTrace: testInfo.stackTrace,
                category: null // Will be classified later
              });
            }

            allTests.push(testInfo);
          }
        }
      }

      for (const childSuite of suite.suites || []) {
        processSuite(childSuite);
      }
    }

    for (const suite of suites) {
      processSuite(suite);
    }

    return {
      passed,
      failed,
      skipped,
      total: passed + failed + skipped,
      duration: totalDuration,
      exitCode,
      failures,
      allTests
    };
  }

  /**
   * Categorize failures as frontend, backend, test, or environment.
   */
  static categorizeFailures(failures) {
    return failures.map(failure => {
      const error = (failure.error || '').toLowerCase();
      const stack = (failure.stackTrace || '').toLowerCase();
      const file = (failure.file || '').toLowerCase();

      let category = 'frontend'; // default

      if (error.includes('timeout') || error.includes('econnrefused') || error.includes('enotfound')) {
        category = 'environment';
      } else if (error.includes('500') || error.includes('internal server error') || stack.includes('api/') || stack.includes('server/')) {
        category = 'backend';
      } else if (file.includes('api/') || file.includes('api-') || error.includes('status code')) {
        category = 'backend';
      } else if (error.includes('selector') || error.includes('locator') || error.includes('expect(') || error.includes('tobetruthy')) {
        category = 'test';
      }

      return { ...failure, category };
    });
  }

  /**
   * Run only specific test files (for fix validation).
   */
  static async runSpecificTests(workDir, testFiles, config = {}) {
    const testDir = path.join(workDir, 'generated-tests');
    const configFile = path.join(testDir, 'playwright.config.js');

    const args = [
      'playwright', 'test',
      '--config', configFile,
      '--reporter', 'json',
      ...testFiles
    ];

    logger.info(`Running specific tests: ${testFiles.join(', ')}`);

    return new Promise((resolve, reject) => {
      let stdout = '';

      const proc = spawn('npx', args, {
        cwd: workDir,
        shell: true,
        stdio: 'pipe',
        timeout: TEST_TIMEOUT,
        env: {
          ...process.env,
          APP_URL: config.appUrl || process.env.APP_URL || 'http://localhost:3000',
          CI: 'true'
        }
      });

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.on('close', (code) => {
        let jsonResults = null;
        try {
          jsonResults = JSON.parse(stdout);
        } catch {
          // Not JSON output
        }
        resolve(TestRunner.parseResults(jsonResults, code));
      });

      proc.on('error', reject);
    });
  }
}

module.exports = TestRunner;
