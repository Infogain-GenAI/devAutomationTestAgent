'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const TEST_TIMEOUT = 10 * 60 * 1000; // 10 minutes per test run

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

    // Ensure @playwright/test is available from the generated-tests directory
    await TestRunner._ensurePlaywrightInstalled(testDir, workDir);

    // Global timeout: cap the entire test run to prevent CI job timeouts
    // Use 12 minutes for large test suites (84+ files) in CI containers
    const globalTimeout = config.globalTimeout || parseInt(process.env.PW_GLOBAL_TIMEOUT) || 12 * 60 * 1000;

    const args = [
      'playwright', 'test',
      '--config', 'playwright.config.js',
      '--global-timeout', String(globalTimeout)
    ];

    if (config.grep) {
      args.push('--grep', config.grep);
    }

    // Exclude human-interaction tagged tests from automated runs
    // These tests have test.skip(true, 'HUMAN INTERACTION REQUIRED: ...')
    // and/or { tag: '@human-interaction' } — grep-invert ensures they don't run
    if (!config.includeHumanTests) {
      args.push('--grep-invert', '@human-interaction');
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn('npx', args, {
        cwd: testDir,
        shell: true,
        stdio: 'pipe',
        timeout: TEST_TIMEOUT,
        env: {
          ...process.env,
          APP_URL: config.appUrl || process.env.APP_URL || 'http://localhost:3000',
          CI: 'true',
          PLAYWRIGHT_HEADLESS: '1',
          DISPLAY: process.env.DISPLAY || ''
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
        const logDir = process.env.LOG_DIR || path.join(workDir, 'logs');
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

        // Try to parse JSON results from reporter output file
        let jsonResults = null;
        if (fs.existsSync(resultsFile)) {
          try {
            jsonResults = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
            logger.info('Parsed test results from reporter output file');
          } catch {
            logger.warn('Failed to parse JSON results file');
          }
        }

        // If no results file, try parsing stdout (fallback)
        if (!jsonResults) {
          try {
            // Playwright JSON reporter output might be mixed with other reporter output
            // Try to extract JSON from stdout
            const jsonMatch = stdout.match(/^\{[\s\S]*\}$/m);
            if (jsonMatch) {
              jsonResults = JSON.parse(jsonMatch[0]);
            } else {
              jsonResults = JSON.parse(stdout);
            }
          } catch {
            if (stdout.trim()) {
              logger.warn('Failed to parse stdout as JSON');
            } else {
              logger.warn('Playwright produced no stdout output — likely a configuration error');
            }
            // Log stderr for debugging
            if (stderr.trim()) {
              logger.warn(`Playwright stderr: ${stderr.slice(0, 500)}`);
            }
          }
        }

        const parsed = TestRunner.parseResults(jsonResults, code);
        
        // Always log stderr when tests fail or 0 tests executed (aids debugging)
        if (code !== 0 && stderr.trim()) {
          logger.warn(`Playwright stderr (exit ${code}): ${stderr.slice(0, 800)}`);
        }
        
        // If 0 tests ran but Playwright exited with error, log stdout too for diagnostics
        if (code !== 0 && parsed.total === 0) {
          if (stdout.trim()) {
            logger.warn(`Playwright stdout (0 tests, exit ${code}): ${stdout.slice(0, 800)}`);
          }
          // Check for common issues
          if (stdout.includes('no tests found') || stdout.includes('No tests found')) {
            logger.warn('Playwright found no matching test files — check testDir and testMatch in playwright.config.js');
          }
          if (stdout.includes('browserType.launch') || stdout.includes('Executable doesn\'t exist') || stderr.includes('browserType.launch')) {
            logger.warn('Playwright browser launch failed — likely a version mismatch with installed browsers');
          }
        }
        
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
   * Ensure @playwright/test is resolvable from the generated-tests directory.
   * Matches the installed playwright CLI version to avoid mismatches.
   */
  static async _ensurePlaywrightInstalled(testDir, workDir) {
    // Check if @playwright/test is already resolvable from testDir AND version matches container
    try {
      const resolvedPath = require.resolve('@playwright/test/package.json', { paths: [testDir] });
      const installedPkg = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
      const installedVersion = installedPkg.version;
      
      // In container: verify the installed version matches the container's browser version
      if (process.env.DOCKER_CONTAINER === 'true') {
        // Container's browsers are for 1.50.0 — only accept that version
        const containerVersion = '1.50.0';
        if (installedVersion && installedVersion.startsWith(containerVersion.split('.').slice(0, 2).join('.'))) {
          logger.info(`@playwright/test@${installedVersion} already available for generated tests`);
          return;
        } else {
          logger.info(`Installed @playwright/test@${installedVersion} doesn't match container browsers (${containerVersion}) — reinstalling`);
          // Remove existing node_modules/@playwright to force fresh install
          const existingPwDir = path.join(testDir, 'node_modules', '@playwright');
          if (fs.existsSync(existingPwDir)) {
            fs.rmSync(existingPwDir, { recursive: true, force: true });
          }
        }
      } else {
        logger.info(`@playwright/test@${installedVersion} already available for generated tests`);
        return;
      }
    } catch (_) {
      // Not found — need to install
    }

    // Check if it exists in project's node_modules (or src/node_modules)
    // IMPORTANT: Do NOT reuse project's Playwright in container — version may not match browsers
    if (process.env.DOCKER_CONTAINER !== 'true') {
      const possiblePaths = [
        path.join(workDir, 'node_modules', '@playwright', 'test'),
        path.join(workDir, 'src', 'node_modules', '@playwright', 'test'),
        path.join(workDir, 'app', 'node_modules', '@playwright', 'test')
      ];

      let existingPath = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          existingPath = path.dirname(path.dirname(p)); // point to node_modules dir
          break;
        }
      }

      if (existingPath) {
        // Create node_modules symlink to reuse existing installation
        const genNodeModules = path.join(testDir, 'node_modules');
        if (!fs.existsSync(genNodeModules)) {
          try {
            fs.symlinkSync(existingPath, genNodeModules, 'junction');
            logger.info(`Linked project node_modules to generated-tests for @playwright/test`);
            return;
          } catch (e) {
            logger.warn(`Could not symlink node_modules: ${e.message}, will install directly`);
          }
        } else {
          return; // already exists
        }
      }
    }

    // Detect installed playwright CLI version to avoid mismatch
    // IMPORTANT: Detect the version that matches the container's pre-installed browsers.
    // Project may have a different Playwright version — we MUST use the container's version.
    let playwrightVersion = '';
    try {
      const { execSync } = require('child_process');
      const os = require('os');
      
      // Method 1: In container (DOCKER_CONTAINER=true), read from /app/node_modules/playwright-core
      // This is the agent's own installed version which matches the Dockerfile browser install
      if (process.env.DOCKER_CONTAINER === 'true') {
        try {
          const agentPkgPath = '/app/node_modules/playwright-core/package.json';
          if (fs.existsSync(agentPkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(agentPkgPath, 'utf-8'));
            if (pkg.version && /^\d+\.\d+\.\d+$/.test(pkg.version)) {
              playwrightVersion = pkg.version;
              logger.info(`Detected container Playwright version (from agent): ${playwrightVersion}`);
            }
          }
        } catch (_) {}
        
        // Method 1b: Check /ms-playwright directory for browser version markers
        if (!playwrightVersion) {
          try {
            const msPlaywright = '/ms-playwright';
            if (fs.existsSync(msPlaywright)) {
              const dirs = fs.readdirSync(msPlaywright);
              // Look for chromium-XXXX directories with .json metadata
              for (const dir of dirs) {
                const infoFile = path.join(msPlaywright, dir, 'INSTALLATION_COMPLETE');
                if (fs.existsSync(infoFile)) {
                  // The Dockerfile uses playwright:v1.50.0 image — extract from agent package
                  break;
                }
              }
            }
          } catch (_) {}
        }
      }
      
      // Method 2: Try to require playwright-core from the system (not from project workDir)
      if (!playwrightVersion) {
        try {
          const globalVersion = execSync(
            'node -e "try{console.log(require(\'playwright-core/package.json\').version)}catch(e){}"',
            { stdio: 'pipe', timeout: 10000, cwd: os.tmpdir() }
          ).toString().trim();
          if (globalVersion && /^\d+\.\d+\.\d+$/.test(globalVersion)) {
            playwrightVersion = globalVersion;
            logger.info(`Detected system Playwright version: ${playwrightVersion}`);
          }
        } catch (_) {}
      }

      // Method 3: npx playwright --version from /tmp (avoids project's local version)
      // But explicitly set PATH to exclude /workspace to prevent picking up project's version
      if (!playwrightVersion) {
        try {
          const env = { ...process.env };
          // Remove workspace paths from NODE_PATH to avoid project's playwright
          delete env.NODE_PATH;
          const versionOutput = execSync('npx playwright --version', {
            stdio: 'pipe', timeout: 15000, cwd: os.tmpdir(), env
          }).toString().trim();
          const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
          if (versionMatch) {
            playwrightVersion = versionMatch[1];
            logger.info(`Detected Playwright CLI version: ${playwrightVersion}`);
          }
        } catch (_) {}
      }
      
      // Method 4: If in container and still no version, use the known Dockerfile version
      if (!playwrightVersion && process.env.DOCKER_CONTAINER === 'true') {
        playwrightVersion = '1.50.0'; // From Dockerfile: mcr.microsoft.com/playwright:v1.50.0-noble
        logger.info(`Using hardcoded container Playwright version: ${playwrightVersion}`);
      }
    } catch (e) {
      logger.warn(`Could not detect playwright version: ${e.message}`);
      // Final fallback for container
      if (process.env.DOCKER_CONTAINER === 'true') {
        playwrightVersion = '1.50.0';
      }
    }

    // Install @playwright/test at the matching version
    const packageSpec = playwrightVersion ? `@playwright/test@${playwrightVersion}` : '@playwright/test';
    logger.info(`Installing ${packageSpec} in generated-tests directory...`);
    
    const genPkgPath = path.join(testDir, 'package.json');
    if (!fs.existsSync(genPkgPath)) {
      fs.writeFileSync(genPkgPath, JSON.stringify({
        name: 'ignis-generated-tests',
        private: true,
        dependencies: {}
      }, null, 2));
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('npm', ['install', '--no-save', packageSpec], {
        cwd: testDir,
        shell: true,
        stdio: 'pipe',
        timeout: 60000,
        env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }
      });
      let stderr = '';
      proc.stderr.on('data', d => stderr += d.toString());
      proc.on('close', (code) => {
        if (code === 0) {
          logger.info(`${packageSpec} installed in generated-tests`);
        } else {
          logger.warn(`${packageSpec} install exited with code ${code}: ${stderr.slice(0, 200)}`);
        }
        resolve();
      });
      proc.on('error', (err) => {
        logger.warn(`Failed to install ${packageSpec}: ${err.message}`);
        resolve(); // don't block — let tests fail with the original error
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
              stackTrace: null,
              skipReason: null
            };

            totalDuration += testInfo.duration;

            if (result.status === 'passed' || result.status === 'expected') {
              passed++;
              testInfo.status = 'passed';
            } else if (result.status === 'skipped') {
              skipped++;
              // Extract skip reason from annotations (test.skip(true, 'reason'))
              const annotations = test.annotations || spec.annotations || [];
              const skipAnnotation = annotations.find(a => a.type === 'skip');
              if (skipAnnotation && skipAnnotation.description) {
                testInfo.skipReason = skipAnnotation.description;
              }
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
   * Scan generated test files for @human-interaction tagged tests.
   * Returns array of { testName, file, reason } for tests excluded from automation.
   * This works even when --grep-invert removes them from JSON output.
   */
  static _findHumanInteractionTests(workDir) {
    const testDir = path.join(workDir, 'generated-tests', 'tests');
    const results = [];

    if (!fs.existsSync(testDir)) return results;

    function scanDir(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules') {
          scanDir(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.spec.js') || entry.name.endsWith('.spec.ts'))) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            // Find all tests with @human-interaction tag
            const tagRegex = /test\s*\(\s*(['"`])(.+?)\1\s*,\s*\{\s*tag:\s*'@human-interaction'\s*\}/g;
            let match;
            while ((match = tagRegex.exec(content)) !== null) {
              const testName = match[2];
              // Extract the skip reason from the test body
              const afterMatch = content.slice(match.index, match.index + 500);
              const reasonMatch = afterMatch.match(/HUMAN INTERACTION REQUIRED:\s*([^']+?)'/);
              const reason = reasonMatch ? reasonMatch[1].trim() : 'Requires human interaction';
              const relFile = path.relative(path.join(workDir, 'generated-tests'), fullPath).replace(/\\/g, '/');
              results.push({ testName, file: relFile, reason });
            }
          } catch { /* skip unreadable files */ }
        }
      }
    }

    scanDir(testDir);
    return results;
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
      
      // Human interaction tests — scan generated files for @human-interaction tagged tests
      const humanInteractionTests = TestRunner._findHumanInteractionTests(workDir);
      // Also include any skipped tests from results that have human-interaction skip reasons
      const skippedHumanTests = (testResults.allTests || []).filter(
        t => t.status === 'skipped' && t.skipReason && t.skipReason.includes('HUMAN INTERACTION')
      );
      
      // Merge both sources (file-scanned + JSON-reported), deduplicate by test name
      const allHumanTests = [...humanInteractionTests];
      for (const st of skippedHumanTests) {
        if (!allHumanTests.some(h => h.testName === st.testName)) {
          allHumanTests.push({ testName: st.testName, file: st.file, reason: st.skipReason });
        }
      }
      
      if (allHumanTests.length > 0) {
        lines.push('═'.repeat(100));
        lines.push('🏷️  HUMAN INTERACTION REQUIRED (Excluded from automated run)');
        lines.push('═'.repeat(100));
        lines.push('');
        lines.push('The following tests require manual execution with human supervision:');
        lines.push('');
        allHumanTests.forEach((test, index) => {
          lines.push(`  ${index + 1}. ⏭️ ${test.testName}`);
          lines.push(`     File:   ${test.file || 'N/A'}`);
          lines.push(`     Reason: ${test.reason}`);
          lines.push('');
        });
        lines.push('To run these tests manually:');
        lines.push('  npx playwright test --grep "@human-interaction" --headed');
        lines.push('');
      }
      
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
          lines.push(`Test:       ${failure.testName}`);
          lines.push(`File:       ${failure.file || 'N/A'}`);
          lines.push(`Category:   ${failure.category || 'unknown'}`);
          lines.push(`Root Cause: ${TestRunner._classifyRootCause(failure)}`);
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
  /**
   * Classify root cause of a test failure for logs and reports
   */
  static _classifyRootCause(failure) {
    const error = (failure.error || '').toLowerCase();
    if (error.includes('timeout') || error.includes('waiting for') || error.includes('exceeded')) return 'Timeout — page or element took too long';
    if (error.includes('econnrefused') || error.includes('enotfound') || error.includes('fetch failed')) return 'Connection error — app not reachable';
    if (error.includes('404') || error.includes('not found')) return 'Endpoint/page not found (404)';
    if (error.includes('500') || error.includes('internal server')) return 'Server error (500)';
    if (error.includes('401') || error.includes('403') || error.includes('unauthorized')) return 'Authentication/authorization error';
    if (error.includes('expect') || error.includes('assert') || error.includes('tobetruthy')) return 'Assertion failed — expected vs actual mismatch';
    if (error.includes('locator') || error.includes('selector') || error.includes('getby')) return 'Selector issue — element not found';
    if (error.includes('syntax') || error.includes('unexpected token') || error.includes('cannot find module')) return 'Code/import error in test file';
    if (error.includes('cors') || error.includes('access-control')) return 'CORS policy blocking request';
    return 'Unknown — review error details below';
  }

}

module.exports = TestRunner;
