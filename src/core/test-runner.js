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
      logger.warn(`Test directory does not exist: ${testDir} — skipping Playwright tests`);
      return {
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        exitCode: 0,
        failures: [],
        allTests: [],
        skippedReason: 'No generated-tests directory found'
      };
    }

    const configFile = path.join(testDir, 'playwright.config.js');
    if (!fs.existsSync(configFile)) {
      logger.warn(`Playwright config not found: ${configFile} — skipping Playwright tests`);
      return {
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        exitCode: 0,
        failures: [],
        allTests: [],
        skippedReason: 'No playwright.config.js found in generated-tests'
      };
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

        // Write raw output to log files for GitHub Actions
        const logDir = process.env.LOG_DIR || 'logs';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const testLogFile = path.join(logDir, `test-run-${timestamp}.log`);
        
        try {
          fs.mkdirSync(logDir, { recursive: true });
          
          const logContent = [
            '═'.repeat(80),
            `PLAYWRIGHT TEST RUN LOG`,
            `Timestamp: ${new Date().toISOString()}`,
            `Exit Code: ${code}`,
            `Working Directory: ${workDir}`,
            `Test Directory: ${testDir}`,
            '═'.repeat(80),
            '',
            'STDOUT:',
            '-'.repeat(80),
            stdout || '(no output)',
            '',
            'STDERR:',
            '-'.repeat(80),
            stderr || '(no errors)',
            '',
            '═'.repeat(80)
          ].join('\n');
          
          fs.writeFileSync(testLogFile, logContent, 'utf-8');
          logger.info(`Test output written to: ${testLogFile}`);
        } catch (err) {
          logger.warn(`Failed to write test log file: ${err.message}`);
        }

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
        
        // Write detailed test results to separate log file
        TestRunner.writeDetailedTestLog(parsed, workDir, testLogFile);
        
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

  /**
   * Write detailed test results to log file for GitHub Actions
   */
  static writeDetailedTestLog(testResults, workDir, originalLogFile) {
    const logDir = process.env.LOG_DIR || 'logs';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const detailedLogFile = path.join(logDir, `test-results-${timestamp}.log`);
    
    try {
      fs.mkdirSync(logDir, { recursive: true });
      
      const lines = [
        '═'.repeat(100),
        `DETAILED TEST RESULTS - IGNIS Automation Test Agent`,
        `Generated: ${new Date().toISOString()}`,
        `Working Directory: ${workDir}`,
        '═'.repeat(100),
        '',
        '📊 SUMMARY',
        '-'.repeat(100),
        `Total Tests:     ${testResults.total}`,
        `✅ Passed:       ${testResults.passed}`,
        `❌ Failed:       ${testResults.failed}`,
        `⏭️  Skipped:      ${testResults.skipped}`,
        `⏱️  Duration:     ${(testResults.duration / 1000).toFixed(2)}s`,
        `🚪 Exit Code:    ${testResults.exitCode}`,
        '',
      ];
      
      // Overall status
      if (testResults.failed === 0) {
        lines.push('✅ STATUS: ALL TESTS PASSED');
      } else {
        lines.push(`❌ STATUS: ${testResults.failed} TEST(S) FAILED`);
      }
      lines.push('');
      
      // Detailed test results
      if (testResults.allTests && testResults.allTests.length > 0) {
        lines.push('═'.repeat(100));
        lines.push('📝 DETAILED TEST RESULTS');
        lines.push('═'.repeat(100));
        lines.push('');
        
        testResults.allTests.forEach((test, index) => {
          const statusIcon = test.status === 'passed' ? '✅' : 
                           test.status === 'failed' ? '❌' : 
                           test.status === 'skipped' ? '⏭️' : '❓';
          
          lines.push(`${index + 1}. ${statusIcon} ${test.testName}`);
          lines.push(`   File:     ${test.file || 'N/A'}`);
          lines.push(`   Status:   ${test.status.toUpperCase()}`);
          lines.push(`   Duration: ${(test.duration / 1000).toFixed(2)}s`);
          
          if (test.error) {
            lines.push(`   Error:    ${test.error}`);
          }
          
          lines.push('');
        });
      }
      
      // Failure details
      if (testResults.failures && testResults.failures.length > 0) {
        lines.push('═'.repeat(100));
        lines.push('❌ FAILURE DETAILS');
        lines.push('═'.repeat(100));
        lines.push('');
        
        testResults.failures.forEach((failure, index) => {
          lines.push(`FAILURE #${index + 1}`);
          lines.push('-'.repeat(100));
          lines.push(`Test:     ${failure.testName}`);
          lines.push(`File:     ${failure.file || 'N/A'}`);
          lines.push(`Category: ${failure.category || 'unknown'}`);
          lines.push('');
          lines.push('Error Message:');
          lines.push(failure.error || 'No error message');
          lines.push('');
          
          if (failure.stackTrace) {
            lines.push('Stack Trace:');
            lines.push(failure.stackTrace);
            lines.push('');
          }
          
          lines.push('');
        });
      }
      
      // Categorized failures summary
      if (testResults.failures && testResults.failures.length > 0) {
        const categorized = TestRunner.categorizeFailures(testResults.failures);
        const categories = {};
        
        categorized.forEach(f => {
          categories[f.category] = (categories[f.category] || 0) + 1;
        });
        
        lines.push('═'.repeat(100));
        lines.push('📊 FAILURE BREAKDOWN BY CATEGORY');
        lines.push('═'.repeat(100));
        lines.push('');
        
        Object.entries(categories).forEach(([category, count]) => {
          const icon = category === 'frontend' ? '🖥️' :
                      category === 'backend' ? '⚙️' :
                      category === 'test' ? '🧪' :
                      category === 'environment' ? '🌐' : '❓';
          lines.push(`${icon} ${category.toUpperCase()}: ${count} failure(s)`);
        });
        lines.push('');
      }
      
      // Recommendations
      lines.push('═'.repeat(100));
      lines.push('💡 RECOMMENDATIONS');
      lines.push('═'.repeat(100));
      lines.push('');
      
      if (testResults.failed === 0) {
        lines.push('✅ All tests passed! No action needed.');
      } else {
        lines.push('To debug failures:');
        lines.push('1. Review the failure details above');
        lines.push('2. Check the stack traces for specific error locations');
        lines.push('3. Review the test files mentioned in failures');
        lines.push('4. Check application logs for backend errors');
        lines.push('5. Verify environment configuration (URLs, ports, secrets)');
        
        if (testResults.failures.some(f => f.category === 'environment')) {
          lines.push('');
          lines.push('⚠️  Environment issues detected:');
          lines.push('   - Check if the application is running and accessible');
          lines.push('   - Verify APP_URL environment variable is correct');
          lines.push('   - Check network connectivity');
          lines.push('   - Ensure required services are up');
        }
        
        if (testResults.failures.some(f => f.category === 'backend')) {
          lines.push('');
          lines.push('⚠️  Backend issues detected:');
          lines.push('   - Review API endpoint implementations');
          lines.push('   - Check server logs for errors');
          lines.push('   - Verify database connectivity');
          lines.push('   - Review API response formats');
        }
        
        if (testResults.failures.some(f => f.category === 'test')) {
          lines.push('');
          lines.push('⚠️  Test issues detected:');
          lines.push('   - Review test selectors and assertions');
          lines.push('   - Update tests if UI has changed');
          lines.push('   - Check for timing issues (add waits if needed)');
          lines.push('   - Verify test data and expectations');
        }
      }
      
      lines.push('');
      lines.push('═'.repeat(100));
      lines.push(`Full test output available in: ${originalLogFile || 'N/A'}`);
      lines.push('═'.repeat(100));
      
      const logContent = lines.join('\n');
      fs.writeFileSync(detailedLogFile, logContent, 'utf-8');
      
      logger.info(`✅ Detailed test results written to: ${detailedLogFile}`);
      logger.info(`   This file contains comprehensive test results for GitHub Actions artifacts`);
      
      // Also write a JSON version for programmatic access
      const jsonLogFile = detailedLogFile.replace('.log', '.json');
      fs.writeFileSync(jsonLogFile, JSON.stringify(testResults, null, 2), 'utf-8');
      logger.info(`   JSON results: ${jsonLogFile}`);
      
    } catch (err) {
      logger.warn(`Failed to write detailed test log: ${err.message}`);
    }
  }
}

module.exports = TestRunner;
