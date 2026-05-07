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
   * Checks root, then common subdirectories (src/, app/, etc.)
   */
  _getFrameworkFromPackageJson(workDir) {
    const candidates = [
      path.join(workDir, 'package.json'),
      path.join(workDir, 'src', 'package.json'),
      path.join(workDir, 'app', 'package.json')
    ];

    for (const packageJsonPath of candidates) {
      if (!fs.existsSync(packageJsonPath)) continue;
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
        logger.warn(`Failed to parse ${packageJsonPath}: ${err.message}`);
      }
    }
    return null;
  }

  /**
   * Find the project root that contains package.json (might be in a subdirectory)
   */
  _findProjectRoot(workDir) {
    if (fs.existsSync(path.join(workDir, 'package.json'))) return workDir;
    const subDirs = ['src', 'app', 'packages'];
    for (const sub of subDirs) {
      const candidate = path.join(workDir, sub);
      if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    }
    return workDir;
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
    const projectRoot = this._findProjectRoot(workDir);
    const packageJsonPath = path.join(projectRoot, 'package.json');
    
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
      execSync(`npx ${framework} --version`, { cwd: projectRoot, stdio: 'pipe', timeout: 10000 });
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
        cwd: projectRoot,
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
    const projectRoot = this._findProjectRoot(workDir);
    const generatedTestsDir = path.join(workDir, 'generated-tests');
    const generatedJestConfig = path.join(generatedTestsDir, 'jest.config.js');
    const projectJestConfig = path.join(projectRoot, 'jest.config.js');
    const projectJestConfigTs = path.join(projectRoot, 'jest.config.ts');
    
    // Prefer project's own jest config, fall back to generated one
    let jestConfigPath = null;
    let jestCwd = projectRoot; // Use project root (where package.json is) as default CWD
    
    if (fs.existsSync(projectJestConfig)) {
      jestConfigPath = projectJestConfig;
      jestCwd = projectRoot;
      logger.info(`Using project jest.config.js (in ${path.relative(workDir, projectRoot) || '.'})`);
    } else if (fs.existsSync(projectJestConfigTs)) {
      jestConfigPath = projectJestConfigTs;
      jestCwd = projectRoot;
      logger.info(`Using project jest.config.ts (in ${path.relative(workDir, projectRoot) || '.'})`);
    } else if (fs.existsSync(generatedJestConfig)) {
      jestConfigPath = generatedJestConfig;
      jestCwd = generatedTestsDir;
      logger.info('Using generated jest.config.js');
    }

    // First attempt: use project's jest config
    let results = await this._executeJest(framework, jestConfigPath, jestCwd, dirs);

    // If project config failed with 0 tests, determine whether it's a config issue or broken spec files
    if (jestConfigPath && results.exitCode !== 0 && results.total === 0 && framework === 'jest') {
      // Check if the error is a missing jest-environment-jsdom (install it and retry)
      if (results.errors.includes('jest-environment-jsdom') && results.errors.includes('cannot be found')) {
        logger.info('jest-environment-jsdom missing — installing and retrying...');
        try {
          const { execSync } = require('child_process');
          execSync('npm install --save-dev jest-environment-jsdom', {
            cwd: jestCwd, stdio: 'pipe', timeout: 60000
          });
          results = await this._executeJest(framework, jestConfigPath, jestCwd, dirs);
        } catch (installErr) {
          logger.warn(`Failed to install jest-environment-jsdom: ${installErr.message}`);
        }
      }
      
      // If still failing with 0 tests, check for broken spec files or config issues
      if (results.exitCode !== 0 && results.total === 0) {
        const brokenFiles = this._extractBrokenSpecFiles(results.errors, results.rawOutput, jestCwd);
      
        if (brokenFiles.length > 0) {
          // Broken spec files detected — attempt to fix them, then retry WITH project config
          logger.warn(`Found ${brokenFiles.length} broken spec file(s): ${brokenFiles.map(f => f.file).join(', ')}`);
          const fixed = await this._fixBrokenSpecFiles(brokenFiles, jestCwd);
          if (fixed > 0) {
            logger.info(`Fixed ${fixed} spec file(s). Retrying with project jest config...`);
            results = await this._executeJest(framework, jestConfigPath, jestCwd, dirs);
          }
        
          // If still 0 tests after fixing spec files, fall back to no config (node env, no .spec files)
          if (results.exitCode !== 0 && results.total === 0) {
            logger.warn(`Still 0 tests after fixing spec files. Stderr: ${results.errors.slice(0, 300)}`);
            logger.info('Retrying without project jest.config.js (backend unit tests only)...');
            results = await this._executeJest(framework, null, jestCwd, dirs);
          }
        } else {
          // No broken spec files identified — likely a config/transform issue
          // Fall back to running only backend-compatible tests (node env, no .spec files)
          logger.warn(`Jest config error (0 tests ran). Stderr: ${results.errors.slice(0, 500)}`);
          logger.info('Retrying without project jest.config.js (backend unit tests only)...');
          results = await this._executeJest(framework, null, jestCwd, dirs);
        }
      }
    }
    
    // If tests ran but some failed due to broken spec files, attempt fix and retry
    if (results.exitCode !== 0 && results.total > 0 && results.failed > 0 && jestConfigPath) {
      const brokenFiles = this._extractBrokenSpecFiles(results.errors, results.rawOutput, jestCwd);
      if (brokenFiles.length > 0) {
        logger.warn(`${brokenFiles.length} spec file(s) have errors: ${brokenFiles.map(f => f.file).join(', ')}`);
        const fixed = await this._fixBrokenSpecFiles(brokenFiles, jestCwd);
        if (fixed > 0) {
          logger.info(`Fixed ${fixed} spec file(s). Re-running tests with project config...`);
          results = await this._executeJest(framework, jestConfigPath, jestCwd, dirs);
        }
      }
    }

    if (results.exitCode === 0) {
      logger.info(`✅ All unit tests passed (${results.passed}/${results.total})`);
    } else if (results.total === 0) {
      logger.warn(`⚠️ Jest exited with errors but ran 0 tests. Stderr: ${results.errors.slice(0, 800)}`);
    } else {
      logger.warn(`❌ Unit tests failed: ${results.failed}/${results.total} failures`);
    }

    return results;
  }

  /**
   * Execute jest/mocha and return parsed results
   */
  _executeJest(framework, configPath, cwd, dirs) {
    return new Promise((resolve, reject) => {
      let args;
      if (framework === 'jest') {
        args = ['--json', '--forceExit'];
        if (configPath) {
          const relConfigPath = path.relative(cwd, configPath);
          args.push('--config', relConfigPath || 'jest.config.js');
        } else {
          // No config — write a temporary jest config file for backend-only mode
          // (Inline JSON via --config is unreliable on Windows PowerShell due to quote escaping)
          const tmpConfigPath = path.join(cwd, '.jest.backend.config.json');
          fs.writeFileSync(tmpConfigPath, JSON.stringify({
            testEnvironment: 'node',
            testPathIgnorePatterns: ['/node_modules/', '.*\\.spec\\.', '.*\\.test\\.ts$', '.*\\.test\\.tsx$']
          }, null, 2), 'utf-8');
          args.push('--config', '.jest.backend.config.json');
          const relDirs = dirs.map(d => path.relative(cwd, d).replace(/\\/g, '/'));
          for (const relDir of relDirs) {
            args.push(relDir);
          }
        }
      } else {
        const testFileGlobs = dirs.map(d => `"${path.join(d, '**/*.test.js')}"`);
        args = ['--reporter', 'json', ...testFileGlobs];
      }

      const fullArgs = framework === 'jest'
        ? ['jest', ...args]
        : ['mocha', ...args];

      const proc = spawn('npx', fullArgs, {
        cwd,
        shell: true,
        stdio: 'pipe',
        timeout: 5 * 60 * 1000
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (text.includes('PASS') || text.includes('FAIL')) {
          logger.info(text.trim());
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        logger.info(`Unit tests exited with code ${code}`);
        const results = this.parseTestResults(stdout, stderr, framework, code);
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
   * Extract broken spec files from Jest error output.
   * Detects: SyntaxError, Cannot find module, import/export errors in test files.
   */
  _extractBrokenSpecFiles(stderr, stdout, cwd) {
    const brokenFiles = [];
    
    // Method 1 (preferred): Parse Jest JSON output for suites that "failed to run"
    try {
      const jsonMatch = stdout.match(/\{.*"success".*\}/s);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[0]);
        if (json.testResults) {
          for (const suite of json.testResults) {
            if (suite.message && /Test suite failed to run/.test(suite.message)) {
              const file = suite.name ? path.relative(cwd, suite.name).replace(/\\/g, '/') : null;
              if (file) {
                const errorType = this._extractErrorType(suite.message);
                const missingModule = suite.message.match(/Cannot find module ['"]([^'"]+)['"]/)?.[1] || null;
                brokenFiles.push({ file, error: errorType, missingModule, context: suite.message.slice(0, 500) });
              }
            }
          }
        }
      }
    } catch (_) {
      // JSON parse failed, fall back to regex
    }

    // Method 2: Regex-based fallback (only if JSON parsing didn't find anything)
    if (brokenFiles.length === 0) {
      const combinedOutput = (stderr || '');
      let match;
      
      // Pattern: "FAIL path/to/file.test.js\n  ● Test suite failed to run"
      const suiteFailPattern = /FAIL\s+([^\n]+\.(?:test|spec)\.(?:js|ts|jsx|tsx))\s*\n[^\n]*Test suite failed to run/g;
      while ((match = suiteFailPattern.exec(combinedOutput)) !== null) {
        const file = match[1].trim().replace(/\\/g, '/');
        if (!brokenFiles.some(b => b.file === file)) {
          const errorContext = combinedOutput.slice(match.index, match.index + 500);
          brokenFiles.push({ file, error: this._extractErrorType(errorContext), context: errorContext.slice(0, 300) });
        }
      }

      // Pattern: Cannot find module in a test file
      const moduleErrorPattern = /Cannot find module ['"]([^'"]+)['"] from ['"]([^'"]*(?:test|spec)[^'"]*)['"]/g;
      while ((match = moduleErrorPattern.exec(combinedOutput)) !== null) {
        const file = match[2].trim().replace(/\\/g, '/');
        const missingModule = match[1];
        if (!brokenFiles.some(b => b.file === file)) {
          brokenFiles.push({ file, error: 'missing-module', missingModule, context: match[0] });
        }
      }

      // Pattern: SyntaxError with file path
      const syntaxPattern = /SyntaxError:\s*([^\n]*(?:test|spec)[^\n]*\.(?:js|ts|jsx|tsx))[:\s]/g;
      while ((match = syntaxPattern.exec(combinedOutput)) !== null) {
        const file = match[1].trim().replace(/\\/g, '/');
        if (!brokenFiles.some(b => b.file === file)) {
          brokenFiles.push({ file, error: 'syntax-error', context: combinedOutput.slice(match.index, match.index + 200) });
        }
      }

      // Pattern: transform/parse error referencing a test file
      const transformPattern = /(?:Could not|Failed to) (?:parse|transform)\s+([^\n]*(?:test|spec)[^\n]*\.(?:js|ts|jsx|tsx))/g;
      while ((match = transformPattern.exec(combinedOutput)) !== null) {
        const file = match[1].trim().replace(/\\/g, '/');
        if (!brokenFiles.some(b => b.file === file)) {
          brokenFiles.push({ file, error: 'transform-error', context: match[0] });
        }
      }
    }

    return brokenFiles;
  }

  /**
   * Extract the error type from error context
   */
  _extractErrorType(context) {
    if (/Cannot find module/.test(context)) return 'missing-module';
    if (/Cannot use import|import statement outside/i.test(context)) return 'esm-import';
    if (/ECMAScript Modules|esm|ES modules/i.test(context)) return 'esm-import';
    if (/unexpected token/i.test(context) && /import|export/.test(context)) return 'esm-import';
    if (/SyntaxError/.test(context)) return 'syntax-error';
    if (/unexpected token/i.test(context)) return 'syntax-error';
    if (/is not defined/.test(context)) return 'undefined-reference';
    if (/Could not|Failed to.*(?:parse|transform)/i.test(context)) return 'transform-error';
    return 'unknown';
  }

  /**
   * Attempt to fix broken spec files with common automated fixes.
   * Returns the number of files successfully fixed.
   */
  async _fixBrokenSpecFiles(brokenFiles, cwd) {
    let fixed = 0;

    for (const broken of brokenFiles) {
      const filePath = path.isAbsolute(broken.file) 
        ? broken.file 
        : path.join(cwd, broken.file);

      if (!fs.existsSync(filePath)) {
        logger.warn(`Broken file not found: ${broken.file} — skipping`);
        continue;
      }

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        let fixedContent = content;
        let wasFixed = false;

        switch (broken.error) {
          case 'missing-module': {
            // If missing a relative import, check if the path is wrong
            if (broken.missingModule && broken.missingModule.startsWith('.')) {
              // Try common path corrections (e.g., ../src/ → ../../src/)
              const corrected = this._tryFixRelativeImport(filePath, broken.missingModule, cwd);
              if (corrected && corrected !== broken.missingModule) {
                fixedContent = content.replace(
                  new RegExp(`(['"])${broken.missingModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(['"])`, 'g'),
                  `$1${corrected}$2`
                );
                wasFixed = true;
                logger.info(`  Fixed import path: ${broken.missingModule} → ${corrected} in ${broken.file}`);
              }
            }
            break;
          }

          case 'esm-import': {
            // Convert ESM imports to CommonJS requires
            if (content.includes('import ') && !content.includes('require(')) {
              fixedContent = this._convertEsmToCommonjs(content);
              wasFixed = fixedContent !== content;
              if (wasFixed) {
                logger.info(`  Converted ESM imports to CommonJS in ${broken.file}`);
              }
            }
            break;
          }

          case 'syntax-error': {
            // Check for common syntax issues
            // Missing semicolons after imports, unclosed brackets, etc.
            const syntaxFix = this._tryFixSyntax(content, broken.context);
            if (syntaxFix && syntaxFix !== content) {
              fixedContent = syntaxFix;
              wasFixed = true;
              logger.info(`  Fixed syntax error in ${broken.file}`);
            }
            break;
          }

          case 'transform-error': {
            // If Jest can't transform the file, it might be using JSX/TSX without proper config
            // Add a @jest-environment jsdom comment or convert JSX
            if ((filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) && !content.includes('@jest-environment')) {
              fixedContent = '/**\n * @jest-environment jsdom\n */\n' + content;
              wasFixed = true;
              logger.info(`  Added @jest-environment jsdom to ${broken.file}`);
            }
            break;
          }
        }

        if (wasFixed) {
          fs.writeFileSync(filePath, fixedContent, 'utf-8');
          fixed++;
        }
      } catch (err) {
        logger.warn(`Failed to fix ${broken.file}: ${err.message}`);
      }
    }

    return fixed;
  }

  /**
   * Try to fix a relative import path by searching for the target module
   */
  _tryFixRelativeImport(testFile, importPath, cwd) {
    const testDir = path.dirname(testFile);
    const resolvedTarget = path.resolve(testDir, importPath);
    
    // Check common extensions
    const extensions = ['', '.js', '.ts', '.jsx', '.tsx', '/index.js', '/index.ts'];
    for (const ext of extensions) {
      if (fs.existsSync(resolvedTarget + ext)) {
        return importPath; // Path is actually correct
      }
    }

    // Try to find the module in common locations relative to cwd
    const moduleName = path.basename(importPath);
    const searchDirs = ['src', 'lib', 'app', 'utils', 'components', 'services', ''];
    
    for (const dir of searchDirs) {
      for (const ext of extensions) {
        const candidate = path.join(cwd, dir, moduleName + ext);
        if (fs.existsSync(candidate)) {
          // Found it — compute relative path from test file
          let relativePath = path.relative(testDir, candidate.replace(/\.(js|ts|jsx|tsx)$/, '')).replace(/\\/g, '/');
          if (!relativePath.startsWith('.')) {
            relativePath = './' + relativePath;
          }
          return relativePath;
        }
      }
    }

    return null; // Cannot resolve
  }

  /**
   * Convert ESM import/export statements to CommonJS
   */
  _convertEsmToCommonjs(content) {
    let result = content;
    
    // import { x, y } from 'module' → const { x, y } = require('module')
    result = result.replace(
      /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g,
      "const {$1} = require('$2')"
    );
    
    // import x from 'module' → const x = require('module')
    result = result.replace(
      /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
      "const $1 = require('$2')"
    );
    
    // import * as x from 'module' → const x = require('module')
    result = result.replace(
      /import\s*\*\s*as\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
      "const $1 = require('$2')"
    );

    // export default → module.exports =
    result = result.replace(/export\s+default\s+/g, 'module.exports = ');
    
    // export { x } → (remove, typically not needed in test files)
    result = result.replace(/export\s*\{[^}]*\}\s*;?\s*\n?/g, '');
    
    return result;
  }

  /**
   * Attempt basic syntax fixes based on error context
   */
  _tryFixSyntax(content, errorContext) {
    // If error mentions "Unexpected token" after an import, likely ESM issue
    if (/Unexpected token.*import|Cannot use import/.test(errorContext)) {
      return this._convertEsmToCommonjs(content);
    }
    
    // If error is about optional chaining (?.) in older Node, can't easily fix
    // If error is about decorators, can't easily fix
    
    return null;
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
            // Only pick up .test.js/.test.ts — NOT .spec.js/.spec.ts (those are Playwright/E2E tests)
            (entry.name.endsWith('.test.js') || entry.name.endsWith('.test.ts')) &&
            !entry.name.endsWith('.spec.js') && !entry.name.endsWith('.spec.ts')
          ) {
            // Skip files that import from @playwright/test (they're E2E, not unit tests)
            try {
              const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 500);
              if (content.includes('@playwright/test') || content.includes('playwright')) {
                continue;
              }
            } catch {}
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
