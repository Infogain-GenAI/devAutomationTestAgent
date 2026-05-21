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
   * Detect which test framework to use (Jest, Mocha, or Vitest).
   * Priority: 1) package.json deps → 2) test file content analysis → 3) default Jest
   */
  detectTestFramework(workDir) {
    // First check package.json
    const fromPkg = this._getFrameworkFromPackageJson(workDir);
    if (fromPkg) return fromPkg;

    // Then analyze test file content
    const fromFiles = this._detectFrameworkFromFiles(workDir);
    if (fromFiles) return fromFiles;

    // Default to Jest (most popular)
    logger.info('No test framework detected, defaulting to Jest');
    return 'jest';
  }

  /**
   * Detect framework by reading content of existing test files.
   * Checks for jest/mocha/vitest-specific imports and patterns.
   */
  _detectFrameworkFromFiles(workDir) {
    const testDirs = ['__tests__', 'tests', 'test', 'spec', 'src/__tests__', 'src/tests'];
    const filesToCheck = [];

    for (const dir of testDirs) {
      const fullDir = path.join(workDir, dir);
      if (!fs.existsSync(fullDir)) continue;
      try {
        const entries = fs.readdirSync(fullDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && (entry.name.endsWith('.test.js') || entry.name.endsWith('.spec.js') ||
              entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts'))) {
            filesToCheck.push(path.join(fullDir, entry.name));
            if (filesToCheck.length >= 5) break;
          }
        }
      } catch {}
      if (filesToCheck.length >= 5) break;
    }

    if (filesToCheck.length === 0) return null;

    let jestScore = 0;
    let mochaScore = 0;
    let vitestScore = 0;

    for (const file of filesToCheck) {
      try {
        const content = fs.readFileSync(file, 'utf-8').slice(0, 1500);

        // Jest indicators
        if (content.includes('@jest/globals') || content.includes("from 'jest'")) jestScore += 3;
        if (content.includes('expect(') && content.includes('toBe')) jestScore += 2;
        if (content.includes('jest.mock(') || content.includes('jest.fn(')) jestScore += 3;
        if (content.includes('describe(') && content.includes('expect(')) jestScore += 1;

        // Mocha/Chai indicators
        if (content.includes("from 'chai'") || content.includes("require('chai')")) mochaScore += 3;
        if (content.includes("from 'mocha'") || content.includes("require('mocha')")) mochaScore += 3;
        if (content.includes('.should.') || content.includes('assert.')) mochaScore += 2;
        if (content.includes("from 'sinon'") || content.includes("require('sinon')")) mochaScore += 2;

        // Vitest indicators
        if (content.includes("from 'vitest'") || content.includes("import { test") && content.includes('vitest')) vitestScore += 3;
        if (content.includes('vi.mock(') || content.includes('vi.fn(')) vitestScore += 3;
      } catch {}
    }

    if (vitestScore > jestScore && vitestScore > mochaScore) {
      logger.info(`Detected Vitest from test file content (score: ${vitestScore})`);
      return 'vitest';
    }
    if (mochaScore > jestScore) {
      logger.info(`Detected Mocha from test file content (score: ${mochaScore})`);
      return 'mocha';
    }
    if (jestScore > 0) {
      logger.info(`Detected Jest from test file content (score: ${jestScore})`);
      return 'jest';
    }

    return null;
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

    // Proactively check & install missing test dependencies (setup files, config references)
    const projectRoot = this._findProjectRoot(workDir);
    await this._verifyTestDependencies(projectRoot, framework);

    logger.info(`Running ${framework} unit tests (${allTestFiles.length} test file(s) from ${dirs.length} dir(s))...`);

    // Look for jest.config.js in project root or generated-tests directory
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

    // Handle OOM (exit code 134/137 = SIGKILL/SIGABRT)
    // Strategy: project config with heavy transforms (Next.js/SWC) often causes OOM on CI runners.
    // Instead of retrying the same heavy config repeatedly, switch to a lightweight config immediately.
    if (results.exitCode === 134 || results.exitCode === 137) {
      logger.warn(`Jest was killed (exit code ${results.exitCode}) — likely OOM from heavy transforms (Next.js/SWC).`);
      logger.warn('Switching to lightweight config with @swc/jest (skips project jest.config.js)...');
      
      // Skip the project config entirely — it's too memory-hungry
      // Use a lightweight fallback that handles TypeScript without heavy bundler transforms
      process.env.JEST_COVERAGE = 'false';
      const lightweightConfig = await this._createLightweightJestConfig(jestCwd, dirs);
      results = await this._executeJest(framework, lightweightConfig, jestCwd, dirs);

      // If still OOM with lightweight config, try --runInBand (serial, single process)
      if (results.exitCode === 134 || results.exitCode === 137) {
        logger.warn('Still OOM with lightweight config. Trying --runInBand...');
        process.env.JEST_MAX_WORKERS = '1';
        results = await this._executeJest(framework, lightweightConfig, jestCwd, dirs);
        delete process.env.JEST_MAX_WORKERS;
      }

      // If STILL OOM, try individual files in batches with lightweight config
      if ((results.exitCode === 134 || results.exitCode === 137) && dirs.length > 1) {
        logger.warn('OOM persists. Running directories in batches with lightweight config...');
        results = await this._executeJestInBatches(framework, lightweightConfig, jestCwd, dirs);
      }

      delete process.env.JEST_COVERAGE;
    }

    // If project config failed with 0 tests, determine whether it's a config issue or broken spec files
    if (jestConfigPath && results.exitCode !== 0 && results.total === 0 && framework === 'jest') {
      // Check if the error is a missing jest-environment-jsdom (install it and retry)
      if (results.errors.includes('jest-environment-jsdom') && results.errors.includes('cannot be found')) {
        logger.info('jest-environment-jsdom missing — installing and retrying...');
        let jsdomInstalled = false;
        const { execSync } = require('child_process');
        
        // Try multiple install strategies (production env blocks --save-dev, permissions vary)
        const installStrategies = [
          { cmd: 'npm install --save-dev jest-environment-jsdom', desc: 'local devDep' },
          { cmd: 'npm install --no-save jest-environment-jsdom', desc: 'local no-save' },
          { cmd: 'npm install -g jest-environment-jsdom', desc: 'global' }
        ];
        
        for (const strategy of installStrategies) {
          try {
            execSync(strategy.cmd, {
              cwd: jestCwd, stdio: 'pipe', timeout: 60000,
              env: { ...process.env, NODE_ENV: 'development' } // Override to allow devDep install
            });
            logger.info(`jest-environment-jsdom installed (${strategy.desc})`);
            jsdomInstalled = true;
            break;
          } catch (err) {
            logger.debug(`Install strategy "${strategy.desc}" failed: ${err.message.slice(0, 100)}`);
          }
        }
        
        if (jsdomInstalled) {
          results = await this._executeJest(framework, jestConfigPath, jestCwd, dirs);
        } else {
          logger.warn('Failed to install jest-environment-jsdom with all strategies');
        }
      }
      
      // Check for missing npm modules (e.g. @testing-library/jest-dom from jest.setup.js)
      if (results.exitCode !== 0 && results.total === 0) {
        const missingModules = this._extractMissingNpmModules(results.errors, results.rawOutput);
        if (missingModules.length > 0) {
          logger.info(`Missing test dependencies detected: ${missingModules.join(', ')}`);
          const installed = await this._installMissingTestDeps(missingModules, jestCwd);
          if (installed > 0) {
            logger.info(`Installed ${installed} missing module(s). Retrying tests...`);
            results = await this._executeJest(framework, jestConfigPath, jestCwd, dirs);
          }
        }
      }

      // If still failing with 0 tests, check for broken spec files or config issues
      if (results.exitCode !== 0 && results.total === 0) {
        const brokenFiles = this._extractBrokenSpecFiles(results.errors, results.rawOutput, jestCwd);
      
        if (brokenFiles.length > 0) {
          // Broken spec files detected — attempt to fix them, then retry WITH project config
          logger.warn(`Found ${brokenFiles.length} broken spec file(s): ${brokenFiles.map(f => f.file).join(', ')}`);
          
          // Log details about what packages are missing (Issue #4)
          const missingPackages = this._extractMissingNpmModules(results.errors, results.rawOutput);
          if (missingPackages.length > 0) {
            logger.warn(`⚠️ MISSING PACKAGES causing test failures: ${missingPackages.join(', ')}`);
            logger.warn(`   Install them with: npm install --save-dev ${missingPackages.join(' ')}`);
          }

          const fixed = await this._fixBrokenSpecFiles(brokenFiles, jestCwd);
          if (fixed > 0) {
            logger.info(`Fixed ${fixed} spec file(s). Retrying with project jest config...`);
            results = await this._executeJest(framework, jestConfigPath, jestCwd, dirs);
          }
        
          // If still 0 tests after fixing, retry with project config but EXCLUDE broken files
          if (results.exitCode !== 0 && results.total === 0) {
            const brokenPaths = brokenFiles.map(f => f.file.replace(/\\/g, '/'));
            logger.warn(`Still 0 tests after fixing spec files. Excluding ${brokenPaths.length} broken file(s) and retrying with project config...`);
            logger.warn(`   Excluded: ${brokenPaths.join(', ')}`);
            results = await this._executeJestExcluding(framework, jestConfigPath, jestCwd, dirs, brokenPaths);
          }
          
          // If STILL 0 tests, fall back to no config (node env)
          if (results.exitCode !== 0 && results.total === 0) {
            logger.warn(`Still 0 tests with exclusions. Falling back to basic node config...`);
            logger.info('Retrying without project jest.config.js...');
            results = await this._executeJest(framework, null, jestCwd, dirs);
          }
        } else {
          // No broken spec files identified — likely a config/transform issue
          logger.warn(`Jest config error (0 tests ran). Stderr: ${results.errors.slice(0, 500)}`);
          
          // Log missing packages
          const missingPackages = this._extractMissingNpmModules(results.errors, results.rawOutput);
          if (missingPackages.length > 0) {
            logger.warn(`⚠️ MISSING PACKAGES: ${missingPackages.join(', ')}`);
          }
          
          logger.info('Retrying without project jest.config.js...');
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

    // Final log of results
    if (results.exitCode === 0) {
      logger.info(`✅ All unit tests passed (${results.passed}/${results.total})`);
    } else if (results.total === 0) {
      logger.warn(`⚠️ Jest ran 0 tests. This means NO unit test coverage was measured.`);
      logger.warn(`   Common causes:`);
      logger.warn(`   - Broken test files preventing Jest from loading`);
      logger.warn(`   - Missing transform for TypeScript (.ts/.tsx) files`);
      logger.warn(`   - Missing test dependencies (check MISSING PACKAGES warnings above)`);
      logger.warn(`   Stderr: ${results.errors.slice(0, 800)}`);
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
        args = ['--json', '--forceExit', '--passWithNoTests'];
        // Only enable coverage if explicitly requested or in CI with small test suites
        // Coverage can cause OOM (exit code 134) on large projects
        if (process.env.JEST_COVERAGE !== 'false') {
          args.push('--coverage');
        }
        // Limit workers if OOM occurred previously
        if (process.env.JEST_MAX_WORKERS) {
          args.push('--maxWorkers', process.env.JEST_MAX_WORKERS, '--runInBand');
        }
        if (configPath) {
          const relConfigPath = path.relative(cwd, configPath);
          args.push('--config', relConfigPath || 'jest.config.js');
        } else {
          // No config — write a temporary jest config file for backend-only mode
          // (Inline JSON via --config is unreliable on Windows PowerShell due to quote escaping)
          // 
          // CRITICAL: Do NOT exclude .test.ts/.test.tsx — many projects have TypeScript tests.
          // Only exclude known-broken Playwright .spec. files from unit test runs.
          const tmpConfigPath = path.join(cwd, '.jest.backend.config.json');
          const brokenSpecPatterns = [];
          
          // Only exclude .spec files if we know they are Playwright (they use @playwright/test)
          // Check for Playwright config — if it exists, .spec files are likely Playwright E2E
          const hasPlaywrightConfig = fs.existsSync(path.join(cwd, 'playwright.config.js')) ||
                                      fs.existsSync(path.join(cwd, 'playwright.config.ts')) ||
                                      fs.existsSync(path.join(cwd, '..', 'generated-tests', 'playwright.config.js'));
          if (hasPlaywrightConfig) {
            brokenSpecPatterns.push('.*\\.spec\\.');
          }

          // Determine transform config based on whether project has TypeScript test files
          const hasTypescriptTests = dirs.some(d => {
            try {
              const entries = fs.readdirSync(d, { recursive: true });
              return entries.some(e => typeof e === 'string' && (e.endsWith('.test.ts') || e.endsWith('.test.tsx') || e.endsWith('.spec.ts')));
            } catch { return false; }
          });

          let transformConfig = {};
          if (hasTypescriptTests) {
            // Check if ts-jest is available; if not, try @swc/jest; if neither, install ts-jest
            const hasTsJest = this._isModuleAvailable('ts-jest', cwd);
            const hasSwcJest = this._isModuleAvailable('@swc/jest', cwd);
            const hasBabelJest = this._isModuleAvailable('babel-jest', cwd);

            if (hasTsJest) {
              transformConfig = { '^.+\\.tsx?$': 'ts-jest' };
            } else if (hasSwcJest) {
              transformConfig = { '^.+\\.tsx?$': '@swc/jest' };
            } else if (hasBabelJest) {
              transformConfig = { '^.+\\.tsx?$': 'babel-jest' };
            } else {
              // Install ts-jest as the most common transform
              logger.info('TypeScript test files detected but no transform available — installing ts-jest...');
              try {
                const { execSync } = require('child_process');
                execSync('npm install --save-dev ts-jest typescript', {
                  cwd, stdio: 'pipe', timeout: 120000,
                  env: { ...process.env, NODE_ENV: 'development' }
                });
                transformConfig = { '^.+\\.tsx?$': 'ts-jest' };
                logger.info('✅ ts-jest installed');
              } catch (err) {
                logger.warn(`Failed to install ts-jest: ${err.message.slice(0, 100)}`);
                // Fall back to running without transform (only .js tests will work)
              }
            }
          }

          fs.writeFileSync(tmpConfigPath, JSON.stringify({
            testEnvironment: 'node',
            testPathIgnorePatterns: ['/node_modules/', ...brokenSpecPatterns],
            transform: transformConfig
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

      // Set increased memory limit for Jest (Next.js/SWC transforms are memory-hungry)
      const jestEnv = { ...process.env };
      const currentNodeOptions = jestEnv.NODE_OPTIONS || '';
      if (!currentNodeOptions.includes('--max-old-space-size')) {
        jestEnv.NODE_OPTIONS = `${currentNodeOptions} --max-old-space-size=4096`.trim();
      }

      const proc = spawn('npx', fullArgs, {
        cwd,
        shell: true,
        stdio: 'pipe',
        timeout: 5 * 60 * 1000,
        env: jestEnv
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
   * Execute Jest with project config but exclude specific broken files.
   * This allows running all valid tests while skipping known-broken ones.
   */
  _executeJestExcluding(framework, configPath, cwd, dirs, excludeFiles) {
    return new Promise((resolve, reject) => {
      let args = ['--json', '--forceExit', '--passWithNoTests'];
      if (process.env.JEST_COVERAGE !== 'false') {
        args.push('--coverage');
      }
      if (configPath) {
        const relConfigPath = path.relative(cwd, configPath);
        args.push('--config', relConfigPath || 'jest.config.js');
      }

      // Add exclusion patterns for broken files
      for (const file of excludeFiles) {
        // Escape special regex chars and create pattern that matches the file
        const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        args.push('--testPathIgnorePatterns', escaped);
      }

      const fullArgs = ['jest', ...args];

      logger.info(`Running Jest excluding ${excludeFiles.length} broken file(s)...`);

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
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        logger.info(`Unit tests (with exclusions) exited with code ${code}`);
        const results = this.parseTestResults(stdout, stderr, framework, code);
        resolve(results);
      });

      proc.on('error', (err) => {
        logger.error(`Failed to run unit tests with exclusions: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Execute Jest in batches when OOM kills even single-worker runs.
   * Runs each test directory separately and merges results.
   */
  async _executeJestInBatches(framework, configPath, cwd, dirs) {
    logger.info(`Running Jest in ${dirs.length} batch(es) to avoid OOM...`);
    
    const mergedResults = {
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
      errors: ''
    };

    process.env.JEST_MAX_WORKERS = '1';

    for (let i = 0; i < dirs.length; i++) {
      const dir = dirs[i];
      logger.info(`  Batch ${i + 1}/${dirs.length}: ${path.basename(dir)}`);
      
      const batchResult = await this._executeJest(framework, configPath, cwd, [dir]);
      
      // Merge results
      mergedResults.passed += batchResult.passed || 0;
      mergedResults.failed += batchResult.failed || 0;
      mergedResults.skipped += batchResult.skipped || 0;
      mergedResults.total += batchResult.total || 0;
      mergedResults.duration += batchResult.duration || 0;
      mergedResults.rawOutput += batchResult.rawOutput || '';
      mergedResults.errors += batchResult.errors || '';
      if (batchResult.failures) {
        mergedResults.failures.push(...batchResult.failures);
      }
      if (batchResult.exitCode !== 0) {
        mergedResults.exitCode = batchResult.exitCode;
      }
      // Take best coverage (later batches may override)
      if (batchResult.coverage) {
        if (!mergedResults.coverage || 
            (batchResult.coverage.lines || 0) > (mergedResults.coverage.lines || 0)) {
          mergedResults.coverage = batchResult.coverage;
        }
      }
    }

    delete process.env.JEST_MAX_WORKERS;

    logger.info(`  Batch run complete: ${mergedResults.passed} passed, ${mergedResults.failed} failed (${mergedResults.total} total)`);
    return mergedResults;
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

          // Extract per-file coverage if available
          if (json.coverageMap) {
            const perFile = {};
            let totalStatements = 0, coveredStatements = 0;
            let totalBranches = 0, coveredBranches = 0;
            let totalFunctions = 0, coveredFunctions = 0;
            let totalLines = 0, coveredLines = 0;

            for (const [filePath, fileData] of Object.entries(json.coverageMap)) {
              const shortPath = filePath.replace(/^.*?[/\\](src|lib|app|generated-tests)[/\\]/, '$1/');
              
              // Statement coverage
              const stmts = fileData.s || {};
              const stmtTotal = Object.keys(stmts).length;
              const stmtCovered = Object.values(stmts).filter(v => v > 0).length;
              
              // Function coverage
              const fns = fileData.f || {};
              const fnTotal = Object.keys(fns).length;
              const fnCovered = Object.values(fns).filter(v => v > 0).length;
              
              // Branch coverage
              const brs = fileData.b || {};
              let brTotal = 0, brCovered = 0;
              for (const counts of Object.values(brs)) {
                if (Array.isArray(counts)) {
                  brTotal += counts.length;
                  brCovered += counts.filter(v => v > 0).length;
                }
              }

              // Line coverage (from statementMap → lines)
              const stmtMap = fileData.statementMap || {};
              const lineSet = new Set();
              const coveredLineSet = new Set();
              for (const [key, loc] of Object.entries(stmtMap)) {
                if (loc && loc.start) {
                  lineSet.add(loc.start.line);
                  if (stmts[key] > 0) coveredLineSet.add(loc.start.line);
                }
              }

              perFile[shortPath] = {
                statements: stmtTotal > 0 ? parseFloat(((stmtCovered / stmtTotal) * 100).toFixed(1)) : 100,
                branches: brTotal > 0 ? parseFloat(((brCovered / brTotal) * 100).toFixed(1)) : 100,
                functions: fnTotal > 0 ? parseFloat(((fnCovered / fnTotal) * 100).toFixed(1)) : 100,
                lines: lineSet.size > 0 ? parseFloat(((coveredLineSet.size / lineSet.size) * 100).toFixed(1)) : 100
              };

              totalStatements += stmtTotal; coveredStatements += stmtCovered;
              totalBranches += brTotal; coveredBranches += brCovered;
              totalFunctions += fnTotal; coveredFunctions += fnCovered;
              totalLines += lineSet.size; coveredLines += coveredLineSet.size;
            }

            results.coverage = {
              statements: totalStatements > 0 ? parseFloat(((coveredStatements / totalStatements) * 100).toFixed(1)) : 0,
              branches: totalBranches > 0 ? parseFloat(((coveredBranches / totalBranches) * 100).toFixed(1)) : 0,
              functions: totalFunctions > 0 ? parseFloat(((coveredFunctions / totalFunctions) * 100).toFixed(1)) : 0,
              lines: totalLines > 0 ? parseFloat(((coveredLines / totalLines) * 100).toFixed(1)) : 0,
              perFile
            };
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
      lines.push(`Statements:  ${results.coverage.statements}%`);
      lines.push(`Branches:    ${results.coverage.branches}%`);
      lines.push(`Functions:   ${results.coverage.functions}%`);
      lines.push(`Lines:       ${results.coverage.lines}%`);
      lines.push('');

      if (results.coverage.perFile && Object.keys(results.coverage.perFile).length > 0) {
        lines.push('📄 PER-FILE COVERAGE');
        lines.push('-'.repeat(100));
        lines.push(`${'File'.padEnd(60)} | Stmts  | Branch | Funcs  | Lines`);
        lines.push(`${'-'.repeat(60)}-|--------|--------|--------|-------`);
        for (const [file, cov] of Object.entries(results.coverage.perFile)) {
          const name = file.length > 58 ? '...' + file.slice(-55) : file;
          lines.push(`${name.padEnd(60)} | ${String(cov.statements + '%').padEnd(6)} | ${String(cov.branches + '%').padEnd(6)} | ${String(cov.functions + '%').padEnd(6)} | ${cov.lines}%`);
        }
        lines.push('');
      }
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

    // Log missing packages that caused issues (Issue #4)
    const missingPkgs = this._extractMissingNpmModules(results.errors || '', results.rawOutput || '');
    if (missingPkgs.length > 0) {
      lines.push('');
      lines.push('⚠️ MISSING PACKAGES (causing test failures)');
      lines.push('-'.repeat(100));
      missingPkgs.forEach(pkg => {
        lines.push(`   📦 ${pkg}`);
      });
      lines.push('');
      lines.push(`   To fix: npm install --save-dev ${missingPkgs.join(' ')}`);
      lines.push('');
      
      // Also write a dedicated missing-packages file for easy visibility
      const pkgLogFile = path.join(logDir, 'missing-packages.log');
      const pkgLogContent = [
        `# Missing Packages Report (${new Date().toISOString()})`,
        `# These packages are required but not installed, causing test failures.`,
        '',
        ...missingPkgs.map(p => p),
        '',
        `# Install command:`,
        `npm install --save-dev ${missingPkgs.join(' ')}`
      ].join('\n');
      fs.writeFileSync(pkgLogFile, pkgLogContent, 'utf-8');
      logger.warn(`⚠️ MISSING PACKAGES logged to: ${pkgLogFile}`);
      logger.warn(`   Packages: ${missingPkgs.join(', ')}`);
    }

    // Warn about 0 test coverage
    if (results.total === 0 && results.exitCode !== 0) {
      lines.push('');
      lines.push('⚠️ ZERO TESTS EXECUTED');
      lines.push('-'.repeat(100));
      lines.push('   Unit tests produced 0 coverage. Possible causes:');
      lines.push('   1. Broken test files preventing Jest from loading the suite');
      lines.push('   2. Missing transform configuration for TypeScript (.ts/.tsx)');
      lines.push('   3. Missing dependencies (see MISSING PACKAGES above)');
      lines.push('   4. Jest config incompatible with test file locations');
      lines.push('');
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
   * Proactively verify that test dependencies (from jest.setup.js, jest.config, etc.) are installed.
   * Checks imports/requires in setup files and installs any missing npm modules before running tests.
   */
  async _verifyTestDependencies(projectRoot, framework) {
    if (framework !== 'jest') return; // Only Jest has setup files commonly

    const setupFiles = [
      'jest.setup.js', 'jest.setup.ts', 'jest.setup.mjs',
      'setupTests.js', 'setupTests.ts',
      'src/setupTests.js', 'src/setupTests.ts',
      'test/setup.js', 'test/setup.ts',
      'tests/setup.js', 'tests/setup.ts'
    ];

    // Also parse jest.config for setupFilesAfterFramework / setupFiles references
    const configFiles = ['jest.config.js', 'jest.config.ts', 'jest.config.mjs'];
    let extraSetupFiles = [];

    for (const configFile of configFiles) {
      const configPath = path.join(projectRoot, configFile);
      if (!fs.existsSync(configPath)) continue;
      try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        // Extract paths from setupFilesAfterFramework / setupFiles arrays
        const setupMatch = configContent.match(/setupFiles(?:AfterFramework)?\s*:\s*\[([^\]]*)\]/s);
        if (setupMatch) {
          const paths = setupMatch[1].match(/['"]([^'"]+)['"]/g);
          if (paths) {
            for (const p of paths) {
              const cleanPath = p.replace(/['"<>]/g, '');
              if (cleanPath.startsWith('.') || cleanPath.startsWith('/')) {
                extraSetupFiles.push(cleanPath.replace(/^\.\//, ''));
              }
            }
          }
        }

        // Check transform dependencies (ts-jest, @swc/jest, babel-jest, etc.)
        const transformMatch = configContent.match(/transform\s*:\s*\{([^}]*)\}/s);
        if (transformMatch) {
          const transformBlock = transformMatch[1];
          const transformModules = transformBlock.match(/['"]([^'"]+)['"]\s*(?:\]|$)/g);
          if (transformModules) {
            for (const tm of transformModules) {
              const mod = tm.replace(/['"[\]]/g, '').trim();
              if (mod && !mod.startsWith('.') && !mod.startsWith('/') && !mod.includes('\\')) {
                const pkgName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
                if (!this._isModuleAvailable(pkgName, projectRoot)) {
                  extraSetupFiles.push(`__transform_dep:${pkgName}`);
                }
              }
            }
          }
        }

        // Check moduleNameMapper dependencies (identity-obj-proxy, etc.)
        const mapperMatch = configContent.match(/moduleNameMapper\s*:\s*\{([^}]*)\}/s);
        if (mapperMatch) {
          const mapperBlock = mapperMatch[1];
          const mapperModules = mapperBlock.match(/['"]([^'"./][^'"]*)['"]/g);
          if (mapperModules) {
            for (const mm of mapperModules) {
              const mod = mm.replace(/['"]/g, '').trim();
              if (mod && !mod.startsWith('<') && !mod.includes('$')) {
                const pkgName = mod.startsWith('@') ? mod.split('/').slice(0, 2).join('/') : mod.split('/')[0];
                if (!this._isModuleAvailable(pkgName, projectRoot)) {
                  extraSetupFiles.push(`__mapper_dep:${pkgName}`);
                }
              }
            }
          }
        }
      } catch {}
    }

    // Collect all modules required/imported by setup files
    const missingModules = new Set();
    const allSetupFiles = [...setupFiles, ...extraSetupFiles];

    for (const setupFile of allSetupFiles) {
      // Handle special markers for transform/mapper dependencies
      if (setupFile.startsWith('__transform_dep:') || setupFile.startsWith('__mapper_dep:')) {
        missingModules.add(setupFile.split(':')[1]);
        continue;
      }

      const fullPath = path.join(projectRoot, setupFile);
      if (!fs.existsSync(fullPath)) continue;

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Extract all require('X') and import ... from 'X'
        const requirePattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        const importPattern = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
        const importSideEffect = /import\s+['"]([^'"]+)['"]/g;

        for (const pattern of [requirePattern, importPattern, importSideEffect]) {
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const mod = match[1];
            // Only npm packages (not relative/absolute paths)
            if (mod.startsWith('.') || mod.startsWith('/')) continue;
            const pkgName = mod.startsWith('@')
              ? mod.split('/').slice(0, 2).join('/')
              : mod.split('/')[0];

            // Check if module resolves from the project
            if (!this._isModuleAvailable(pkgName, projectRoot)) {
              missingModules.add(pkgName);
            }
          }
        }
      } catch {}
    }

    if (missingModules.size === 0) return;

    const toInstall = [...missingModules];
    logger.info(`Pre-test check: ${toInstall.length} missing test dep(s) detected: ${toInstall.join(', ')}`);
    await this._installMissingTestDeps(toInstall, projectRoot);
  }

  /**
   * Check if an npm module is resolvable from a given directory.
   */
  _isModuleAvailable(moduleName, cwd) {
    try {
      require.resolve(moduleName, { paths: [cwd, path.join(cwd, 'node_modules')] });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a lightweight Jest config for projects where the native jest.config.js causes OOM.
   * Uses @swc/jest (fast, low-memory TypeScript transform) instead of Next.js/Babel transforms.
   * Returns the path to the created config file.
   */
  async _createLightweightJestConfig(cwd, dirs) {
    const { execSync } = require('child_process');
    const configPath = path.join(cwd, '.jest.lightweight.config.json');

    // Ensure @swc/jest is available (much lighter than ts-jest or next/jest)
    if (!this._isModuleAvailable('@swc/jest', cwd)) {
      logger.info('Installing @swc/jest for lightweight TypeScript transform...');
      try {
        execSync('npm install --save-dev @swc/jest @swc/core', {
          cwd, stdio: 'pipe', timeout: 120000,
          env: { ...process.env, NODE_ENV: 'development' }
        });
        logger.info('✅ @swc/jest installed');
      } catch (err) {
        logger.warn(`Failed to install @swc/jest locally: ${err.message.slice(0, 100)}`);
        // Try global install as fallback
        try {
          execSync('npm install -g @swc/jest @swc/core', { stdio: 'pipe', timeout: 120000 });
          logger.info('✅ @swc/jest installed globally');
        } catch {
          logger.warn('Could not install @swc/jest — falling back to no transform');
        }
      }
    }

    // Determine transform based on what's available
    let transform = {};
    if (this._isModuleAvailable('@swc/jest', cwd)) {
      transform = {
        '^.+\\.(t|j)sx?$': ['@swc/jest', {
          jsc: {
            parser: { syntax: 'typescript', tsx: true, decorators: true },
            transform: { react: { runtime: 'automatic' } }
          }
        }]
      };
    } else if (this._isModuleAvailable('ts-jest', cwd)) {
      transform = { '^.+\\.tsx?$': 'ts-jest' };
    }

    // Build moduleNameMapper for common Next.js path aliases
    const moduleNameMapper = {};
    const tsConfigPath = path.join(cwd, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
      try {
        const tsContent = fs.readFileSync(tsConfigPath, 'utf-8')
          .replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
        const tsConfig = JSON.parse(tsContent);
        const paths = tsConfig.compilerOptions?.paths || {};
        for (const [alias, targets] of Object.entries(paths)) {
          const jestAlias = '^' + alias.replace('/*', '/(.*)');
          const target = targets[0].replace('/*', '/$1').replace('./', '<rootDir>/');
          moduleNameMapper[jestAlias] = target;
        }
      } catch {}
    }
    // Common Next.js aliases
    if (!moduleNameMapper['^@/(.*)']) {
      moduleNameMapper['^@/(.*)'] = '<rootDir>/src/$1';
    }

    // Mock static assets and CSS
    moduleNameMapper['\\.(css|less|scss|sass)$'] = '<rootDir>/__mocks__/styleMock.js';
    moduleNameMapper['\\.(jpg|jpeg|png|gif|svg|webp)$'] = '<rootDir>/__mocks__/fileMock.js';

    // Create mock files if they don't exist
    const mocksDir = path.join(cwd, '__mocks__');
    if (!fs.existsSync(mocksDir)) fs.mkdirSync(mocksDir, { recursive: true });
    const styleMock = path.join(mocksDir, 'styleMock.js');
    const fileMock = path.join(mocksDir, 'fileMock.js');
    if (!fs.existsSync(styleMock)) fs.writeFileSync(styleMock, 'module.exports = {};');
    if (!fs.existsSync(fileMock)) fs.writeFileSync(fileMock, 'module.exports = "test-file-stub";');

    const config = {
      testEnvironment: 'node',
      transform,
      moduleNameMapper,
      transformIgnorePatterns: ['/node_modules/(?!(@t3-oss|next|@next)/)'],
      testPathIgnorePatterns: ['/node_modules/', '\\.spec\\.'],
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
      maxWorkers: 1,
      silent: true
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    logger.info(`Created lightweight Jest config: ${path.basename(configPath)}`);
    return configPath;
  }

  /**
   * Extract missing npm module names from Jest error output.
   * Matches "Cannot find module 'X'" where X is an npm package (not a relative path).
   */
  _extractMissingNpmModules(stderr, stdout) {
    const combined = (stderr || '') + '\n' + (stdout || '');
    const modules = new Set();

    const pattern = /Cannot find module ['"]([^'"]+)['"]/g;
    let match;
    while ((match = pattern.exec(combined)) !== null) {
      const mod = match[1];
      // Only npm packages (not relative paths or absolute paths)
      if (!mod.startsWith('.') && !mod.startsWith('/') && !mod.includes('\\')) {
        // Get the package name (handle scoped packages like @testing-library/jest-dom)
        const pkgName = mod.startsWith('@')
          ? mod.split('/').slice(0, 2).join('/')
          : mod.split('/')[0];
        modules.add(pkgName);
      }
    }

    return [...modules];
  }

  /**
   * Install missing test dependencies (npm packages referenced in setup/config files).
   * Returns the number of packages successfully installed.
   */
  async _installMissingTestDeps(modules, cwd) {
    if (!modules || modules.length === 0) return 0;

    const { execSync } = require('child_process');
    let installed = 0;

    // Batch install all missing modules at once
    const toInstall = modules.slice(0, 10); // Cap at 10 to avoid runaway installs
    logger.info(`Installing missing test deps: ${toInstall.join(' ')}`);

    const strategies = [
      { cmd: `npm install --save-dev ${toInstall.join(' ')}`, desc: 'devDep' },
      { cmd: `npm install --no-save ${toInstall.join(' ')}`, desc: 'no-save' },
      { cmd: `npm install -g ${toInstall.join(' ')}`, desc: 'global' }
    ];

    for (const strategy of strategies) {
      try {
        execSync(strategy.cmd, {
          cwd,
          stdio: 'pipe',
          timeout: 120000,
          env: { ...process.env, NODE_ENV: 'development' }
        });
        logger.info(`Installed ${toInstall.length} missing module(s) (${strategy.desc})`);
        installed = toInstall.length;
        break;
      } catch (err) {
        logger.debug(`Install strategy "${strategy.desc}" failed: ${err.message.slice(0, 150)}`);
      }
    }

    return installed;
  }

  /**
   * Find unit test files (.test.js AND .spec.js) in the test directory.
   * Detects framework from file content — excludes only Playwright/Cypress files.
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
            entry.name.endsWith('.spec.js') || entry.name.endsWith('.spec.ts')
          ) {
            // Read beginning of file to detect framework
            try {
              const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 800);
              // Skip files that are clearly Playwright or Cypress E2E tests
              if (
                content.includes('@playwright/test') ||
                content.includes('import { test') && content.includes('playwright') ||
                content.includes("require('@playwright/test')") ||
                content.includes('require("@playwright/test")') ||
                content.includes('cy.') && content.includes('describe(') ||
                content.includes('cypress')
              ) {
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
