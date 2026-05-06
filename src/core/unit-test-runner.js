'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class UnitTestRunner {
  constructor(config) {
    this.config = config;
  }

  /**
   * Check package.json for explicitly declared test framework (highest priority)
   */
  _getFrameworkFromPackageJson(workDir) {
    const packageJsonPath = path.join(workDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return null;

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };

      if (deps['jest'] || deps['@jest/globals']) return 'jest';
      if (deps['mocha']) return 'mocha';
      if (deps['vitest']) return 'vitest';
    } catch (err) {
      logger.warn(`Failed to parse package.json: ${err.message}`);
    }
    return null;
  }

  /**
   * Detect which test framework to use (Jest or Mocha)
   */
  detectTestFramework(workDir) {
    const packageJsonPath = path.join(workDir, 'package.json');
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const deps = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies
        };
        
        if (deps['jest'] || deps['@jest/globals']) {
          logger.info('Detected Jest test framework');
          return 'jest';
        }
        
        if (deps['mocha']) {
          logger.info('Detected Mocha test framework');
          return 'mocha';
        }
      } catch (err) {
        logger.warn(`Failed to parse package.json: ${err.message}`);
      }
    }
    
    // Default to Jest (more popular)
    logger.info('No test framework detected, defaulting to Jest');
    return 'jest';
  }

  /**
   * Install test framework if not present
   */
  async installTestFramework(workDir, framework) {
    const packageJsonPath = path.join(workDir, 'package.json');
    
    // If no package.json exists, create a minimal one for the test runner
    if (!fs.existsSync(packageJsonPath)) {
      logger.info('No package.json found — creating minimal package.json for test framework');
      const minimalPkg = {
        name: 'ignis-generated-tests',
        version: '1.0.0',
        private: true,
        scripts: {
          test: framework === 'jest' ? 'jest' : 'mocha'
        }
      };
      fs.writeFileSync(packageJsonPath, JSON.stringify(minimalPkg, null, 2), 'utf-8');
    }

    // Check if framework is already globally available
    try {
      const { execSync } = require('child_process');
      execSync(`npx ${framework} --version`, { cwd: workDir, stdio: 'pipe', timeout: 10000 });
      logger.info(`${framework} is already available`);
      return;
    } catch {
      // Not available, need to install
    }

    const deps = framework === 'jest' 
      ? ['jest', '@types/jest', 'supertest']
      : ['mocha', 'chai', '@types/mocha', '@types/chai', 'supertest'];
    
    logger.info(`Installing ${framework} test framework: ${deps.join(', ')}...`);

    return new Promise((resolve, reject) => {
      const proc = spawn('npm', ['install', '--save-dev', ...deps], {
        cwd: workDir,
        shell: true,
        stdio: 'pipe',
        timeout: 120000 // 2 min timeout for install
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          logger.info('Test framework installed successfully');
          resolve();
        } else {
          logger.warn(`Test framework installation failed: ${stderr.slice(-200)}`);
          resolve(); // Don't fail if installation fails - tests might still work via global
        }
      });

      proc.on('error', (err) => {
        logger.warn(`Failed to install test framework: ${err.message}`);
        resolve();
      });
    });
  }

  /**
   * Run unit tests using Jest or Mocha
   * @param {string} workDir - Project root directory
   * @param {string|string[]} testDirs - Test directory or array of test directories
   * @param {object} options - { detectedFrameworks: string[] }
   */
  async runTests(workDir, testDirs, options = {}) {
    // Normalize to array
    const dirs = Array.isArray(testDirs) ? testDirs : [testDirs];
    
    // Detect framework — prioritize package.json, then scanner heuristics, then default
    let framework;
    const packageJsonFramework = this._getFrameworkFromPackageJson(workDir);
    if (packageJsonFramework) {
      // package.json explicitly declares a test framework — highest priority
      framework = packageJsonFramework;
      logger.info(`Using test framework from package.json: ${framework}`);
    } else if (options.detectedFrameworks && options.detectedFrameworks.length > 0) {
      // Fall back to framework detected from test file content
      framework = options.detectedFrameworks[0];
      logger.info(`Using detected test framework: ${framework}`);
    } else {
      // Default
      framework = 'jest';
      logger.info('No test framework detected, defaulting to jest');
    }
    
    // Collect all unit test files from all directories
    const allTestFiles = [];
    for (const dir of dirs) {
      const files = this._findUnitTestFiles(dir);
      allTestFiles.push(...files);
    }
    
    if (allTestFiles.length === 0) {
      logger.info('No unit test files (.test.js) found in any directory — skipping unit test execution');
      return {
        framework,
        passed: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        duration: 0,
        exitCode: 0,
        failures: [],
        coverage: null,
        rawOutput: '',
        errors: '',
        skippedReason: 'No .test.js files found'
      };
    }

    // Ensure test framework is available
    await this.installTestFramework(workDir, framework);

    logger.info(`Running ${framework} unit tests (${allTestFiles.length} test file(s) from ${dirs.length} dir(s))...`);

    // Look for jest.config.js in project root or generated-tests directory
    const generatedTestsDir = path.join(workDir, 'generated-tests');
    const generatedJestConfig = path.join(generatedTestsDir, 'jest.config.js');
    const projectJestConfig = path.join(workDir, 'jest.config.js');
    
    // Prefer project's own jest config, fall back to generated one
    let jestConfigPath = null;
    let jestCwd = workDir;
    
    if (fs.existsSync(projectJestConfig)) {
      jestConfigPath = projectJestConfig;
      jestCwd = workDir;
      logger.info('Using project jest.config.js');
    } else if (fs.existsSync(generatedJestConfig)) {
      jestConfigPath = generatedJestConfig;
      jestCwd = generatedTestsDir;
      logger.info('Using generated jest.config.js');
    }

    return new Promise((resolve, reject) => {
      let args;
      if (framework === 'jest') {
        args = ['--json', '--forceExit'];
        if (jestConfigPath) {
          // Use relative config path from cwd
          const relConfigPath = path.relative(jestCwd, jestConfigPath);
          args.push('--config', relConfigPath || 'jest.config.js');
        } else {
          // No config — provide testMatch and patterns inline
          const relDirs = dirs.map(d => path.relative(workDir, d).replace(/\\/g, '/'));
          let dirGlob;
          if (relDirs.length === 1) {
            dirGlob = relDirs[0];
          } else {
            dirGlob = `{${relDirs.join(',')}}`;
          }
          args.push('--testMatch', `**/${dirGlob}/**/*.{test,spec}.{js,ts,jsx,tsx}`);
          // Only ignore node_modules and generated-tests spec files (those are Playwright e2e)
          args.push('--testPathIgnorePatterns', '/node_modules/', 'generated-tests/tests/.*.spec\\.');
        }
      } else {
        // Mocha: pass all test files directly
        const testFileGlobs = dirs.map(d => `"${path.join(d, '**/*.test.js')}"`);
        args = ['--reporter', 'json', ...testFileGlobs];
      }

      const fullArgs = framework === 'jest' 
        ? ['jest', ...args]
        : ['mocha', ...args];

      const proc = spawn('npx', fullArgs, {
        cwd: jestCwd,
        shell: true,
        stdio: 'pipe',
        timeout: 5 * 60 * 1000 // 5 minutes
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        // Log progress
        if (text.includes('PASS') || text.includes('FAIL')) {
          logger.info(text.trim());
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        logger.info(`Unit tests exited with code ${code}`);

        // Parse results
        const results = this.parseTestResults(stdout, stderr, framework, code);
        
        if (code === 0) {
          logger.info(`✅ All unit tests passed (${results.passed}/${results.total})`);
        } else {
          logger.warn(`❌ Unit tests failed: ${results.failed}/${results.total} failures`);
        }

        resolve(results);
      });

      proc.on('error', (err) => {
        logger.error(`Failed to run unit tests: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Parse test results from Jest/Mocha output
   */
  parseTestResults(stdout, stderr, framework, exitCode) {
    const results = {
      framework,
      passed: 0,
      failed: 0,
      skipped: 0,
      total: 0,
      duration: 0,
      exitCode,
      failures: [],
      coverage: null,
      rawOutput: stdout,
      errors: stderr
    };

    try {
      if (framework === 'jest') {
        // Try to parse Jest JSON output
        const jsonMatch = stdout.match(/\{.*"success".*\}/s);
        if (jsonMatch) {
          const json = JSON.parse(jsonMatch[0]);
          results.passed = json.numPassedTests || 0;
          results.failed = json.numFailedTests || 0;
          results.skipped = json.numPendingTests || 0;
          results.total = json.numTotalTests || 0;
          results.duration = json.testResults?.reduce((sum, r) => sum + (r.perfStats?.runtime || 0), 0) || 0;
          
          if (json.testResults) {
            results.failures = json.testResults
              .filter(r => r.status === 'failed')
              .flatMap(r => r.assertionResults
                .filter(a => a.status === 'failed')
                .map(a => ({
                  testName: a.fullName || a.title,
                  file: r.name,
                  error: a.failureMessages?.join('\n') || 'Unknown error'
                }))
              );
          }

          // Extract coverage if available
          if (json.coverageMap) {
            const totals = Object.values(json.coverageMap).reduce((acc, file) => ({
              lines: acc.lines + (file.s || {}),
              statements: acc.statements + (file.f || {}),
              branches: acc.branches + (file.b || {}),
              functions: acc.functions + (file.fnMap || {})
            }), { lines: 0, statements: 0, branches: 0, functions: 0 });
            
            results.coverage = totals;
          }
        } else {
          // Fallback: parse plain text output
          const passMatch = stdout.match(/(\d+) passing/);
          const failMatch = stdout.match(/(\d+) failing/);
          results.passed = passMatch ? parseInt(passMatch[1]) : 0;
          results.failed = failMatch ? parseInt(failMatch[1]) : 0;
          results.total = results.passed + results.failed;
        }
      } else if (framework === 'mocha') {
        // Parse Mocha JSON output
        const jsonMatch = stdout.match(/\{.*"stats".*\}/s);
        if (jsonMatch) {
          const json = JSON.parse(jsonMatch[0]);
          results.passed = json.stats?.passes || 0;
          results.failed = json.stats?.failures || 0;
          results.skipped = json.stats?.pending || 0;
          results.total = json.stats?.tests || 0;
          results.duration = json.stats?.duration || 0;
          
          if (json.failures) {
            results.failures = json.failures.map(f => ({
              testName: f.fullTitle || f.title,
              file: f.file,
              error: f.err?.message || 'Unknown error'
            }));
          }
        } else {
          // Fallback
          const passMatch = stdout.match(/(\d+) passing/);
          const failMatch = stdout.match(/(\d+) failing/);
          results.passed = passMatch ? parseInt(passMatch[1]) : 0;
          results.failed = failMatch ? parseInt(failMatch[1]) : 0;
          results.total = results.passed + results.failed;
        }
      }
    } catch (err) {
      logger.warn(`Failed to parse test results: ${err.message}`);
      // Use exit code as fallback
      if (exitCode === 0) {
        results.passed = 1;
        results.total = 1;
      } else {
        results.failed = 1;
        results.total = 1;
      }
    }

    return results;
  }

  /**
   * Write unit test results to log file
   */
  writeResultsToLog(results, workDir) {
    const logDir = process.env.LOG_DIR || path.join(workDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(logDir, `unit-test-results-${timestamp}.log`);
    
    const lines = [
      '═'.repeat(100),
      'UNIT TEST RESULTS',
      `Generated: ${new Date().toISOString()}`,
      `Framework: ${results.framework}`,
      '═'.repeat(100),
      '',
      '📊 SUMMARY',
      '-'.repeat(100),
      `Total Tests:  ${results.total}`,
      `✅ Passed:    ${results.passed}`,
      `❌ Failed:    ${results.failed}`,
      `⏭️  Skipped:   ${results.skipped}`,
      `⏱️  Duration:  ${(results.duration / 1000).toFixed(2)}s`,
      `🚪 Exit Code: ${results.exitCode}`,
      ''
    ];

    if (results.coverage) {
      lines.push('📈 CODE COVERAGE');
      lines.push('-'.repeat(100));
      lines.push(`Lines:       ${results.coverage.lines}%`);
      lines.push(`Statements:  ${results.coverage.statements}%`);
      lines.push(`Branches:    ${results.coverage.branches}%`);
      lines.push(`Functions:   ${results.coverage.functions}%`);
      lines.push('');
    }

    if (results.failures && results.failures.length > 0) {
      lines.push('❌ FAILURES');
      lines.push('-'.repeat(100));
      results.failures.forEach((failure, idx) => {
        lines.push(`${idx + 1}. ${failure.testName}`);
        lines.push(`   File: ${failure.file}`);
        lines.push(`   Error: ${failure.error.split('\n')[0]}`);
        lines.push('');
      });
    }

    lines.push('═'.repeat(100));
    lines.push(`Full output available in: ${logFile}`);
    lines.push('═'.repeat(100));

    fs.writeFileSync(logFile, lines.join('\n'), 'utf-8');
    logger.info(`Unit test results written to: ${logFile}`);

    // Also write JSON format
    const jsonFile = path.join(logDir, `unit-test-results-${timestamp}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(results, null, 2), 'utf-8');

    return logFile;
  }

  /**
   * Find unit test files (.test.js) in the test directory
   */
  _findUnitTestFiles(testDir) {
    const files = [];
    if (!fs.existsSync(testDir)) return files;

    function walk(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (
            entry.name.endsWith('.test.js') || entry.name.endsWith('.test.ts') ||
            entry.name.endsWith('.test.jsx') || entry.name.endsWith('.test.tsx') ||
            entry.name.endsWith('.spec.js') || entry.name.endsWith('.spec.ts') ||
            entry.name.endsWith('.spec.jsx') || entry.name.endsWith('.spec.tsx')
          ) {
            files.push(fullPath);
          }
        }
      } catch {}
    }

    walk(testDir);
    return files;
  }
}

module.exports = UnitTestRunner;
