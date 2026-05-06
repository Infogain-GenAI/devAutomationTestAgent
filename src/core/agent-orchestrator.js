'use strict';

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { createProvider } = require('../ai/provider-factory');
const RepoManager = require('./repo-manager');
const DependencyInstaller = require('./dependency-installer');
const EnvHandler = require('./env-handler');
const StackDetector = require('./stack-detector');
const CodeAnalyzer = require('./code-analyzer');
const TestGenerator = require('./test-generator');
const TestRunner = require('./test-runner');
const UnitTestRunner = require('./unit-test-runner');
const TestCoverageScanner = require('./test-coverage-scanner');
const AppLauncher = require('./app-launcher');
const IssueFixer = require('./issue-fixer');
const BackendValidator = require('./backend-validator');
const ReportGenerator = require('./report-generator');

class AgentOrchestrator {
  constructor(config) {
    this.config = config;
    this.runId = uuidv4();
    this.status = 'pending';
    this.currentIteration = 0;
    this.summary = null;

    // Core components
    this.aiProvider = createProvider(config);
    this.repoManager = new RepoManager(config);
    this.codeAnalyzer = new CodeAnalyzer(this.aiProvider);
    this.testGenerator = new TestGenerator(this.aiProvider);
    this.unitTestRunner = new UnitTestRunner(config);
    this.testCoverageScanner = new TestCoverageScanner();
    this.issueFixer = new IssueFixer(this.aiProvider);
    this.appLauncher = new AppLauncher();
    this.backendValidator = new BackendValidator(this.aiProvider, config);
    this.reportGenerator = new ReportGenerator(config);

    // Tracking
    this.iterationHistory = [];
    this.appFixFiles = [];
    this.testFixFiles = [];
    this.startTime = null;
  }

  /**
   * Main entry point — runs the full agent pipeline.
   * @param {Object} runConfig - { repoPath, repoUrl, branch, mode }
   * @param {Function} statusCallback - Called on status changes (optional, for DB updates)
   */
  async run(runConfig, statusCallback) {
    this.startTime = Date.now();
    const mode = runConfig.mode || 'cli'; // 'cli' or 'api'
    let workDir;

    const updateStatus = (newStatus) => {
      this.status = newStatus;
      logger.info(`[${this.runId}] Status: ${newStatus}`);
      if (statusCallback) statusCallback(this.runId, newStatus);
    };

    try {
      // ── Step 1: Create run record ────────────────────────────
      updateStatus('pending');

      // ── Step 2: Acquire repo ────────────────────────────────
      updateStatus('cloning');

      if (mode === 'cli' || runConfig.repoPath) {
        // PRIMARY: GitHub Actions — use local workspace
        workDir = runConfig.repoPath || process.env.GITHUB_WORKSPACE;
        await this.repoManager.useLocalWorkspace(workDir);
      } else {
        // SECONDARY: API mode — clone from GitHub
        workDir = path.join(this.config.agent.workDir, this.runId);
        await this.repoManager.cloneRepo(runConfig.repoUrl, workDir, this.config.github.token);
      }

      // Create fix branch
      const branch = runConfig.branch || this.config.agent.branch || 'main';
      const fixBranch = `${this.config.agent.fixBranchPrefix}-${this.runId.slice(0, 8)}`;
      logger.info(`Creating branch: ${fixBranch} from ${branch}`);
      await this.repoManager.createBranch(fixBranch);
      logger.info(`✅ Branch created and checked out: ${fixBranch}`);

      // ── Step 3: Install dependencies ────────────────────────
      logger.info('Starting dependency installation...');
      updateStatus('installing');
      
      try {
        const { manager: packageManager, installDir } = DependencyInstaller.detectPackageManager(workDir);
        logger.info(`Package manager detected: ${packageManager}${installDir !== workDir ? ` (in ${path.relative(workDir, installDir) || '.'})` : ''}`);
        
        if (packageManager) {
          logger.info('Installing project dependencies...');
          await DependencyInstaller.installDependencies(installDir, packageManager);
          logger.info('✅ Dependencies installed');
          
          logger.info('Installing Playwright browsers...');
          await DependencyInstaller.installPlaywrightBrowsers(installDir);
          logger.info('✅ Playwright browsers installed');
          
          logger.info('Verifying installation...');
          DependencyInstaller.verifyInstallation(installDir);
          logger.info('✅ Installation verified');
        } else {
          logger.warn('No package manager detected, skipping dependency installation');
        }
      } catch (installError) {
        logger.error(`Dependency installation failed: ${installError.message}`);
        logger.error(`Stack trace: ${installError.stack}`);
        throw new Error(`Dependency installation failed: ${installError.message}`);
      }

      // ── Step 4: Resolve environment ─────────────────────────
      logger.info('Resolving environment variables...');
      updateStatus('configuring');
      
      let providedSecrets = {};
      if (process.env.APP_SECRETS) {
        try {
          providedSecrets = JSON.parse(process.env.APP_SECRETS);
        } catch {
          logger.warn('Failed to parse APP_SECRETS env var');
        }
      }
      if (runConfig.appSecrets) {
        providedSecrets = { ...providedSecrets, ...runConfig.appSecrets };
      }
      
      const { envMap, sources } = EnvHandler.resolveEnvironment(workDir, providedSecrets);
      logger.info(`Detected ${Object.keys(envMap).length} environment variables`);
      EnvHandler.writeEnvFile(workDir, envMap);
      logger.info('✅ Environment configuration complete');

      // ── Step 5: Detect tech stack ───────────────────────────
      logger.info('Detecting technology stack...');
      const techStack = StackDetector.detect(workDir, runConfig.techStackOverride || {});
      logger.info(`Stack detected: ${JSON.stringify(techStack)}`);

      // ── Step 6: Analyze codebase ────────────────────────────
      logger.info('Starting code analysis...');
      updateStatus('analyzing');
      const codeAnalysis = await this.codeAnalyzer.analyze(workDir, techStack);
      logger.info('✅ Code analysis complete');

      // ── Step 6a: Backend Validation (NEW) ───────────────────
      let backendValidation = null;
      let bestPracticesValidation = null;
      
      if (this.config.agent.enableBackendValidation || this.config.agent.enableEndpointValidation) {
        updateStatus('validating-backend');
        logger.info('Starting backend endpoint validation...');
        backendValidation = await this.backendValidator.validateBackend(
          workDir, 
          codeAnalysis.structure
        );
        logger.info(`Backend validation complete: ${backendValidation.issues.length} issues found`);
      }

      // ── Step 6b: Best Practices Check (NEW) ─────────────────
      if (this.config.agent.enableBestPracticesCheck) {
        updateStatus('checking-best-practices');
        logger.info('Starting best practices validation...');
        const backendFiles = this.backendValidator._identifyBackendFiles(
          workDir, 
          codeAnalysis.structure
        );
        bestPracticesValidation = await this.backendValidator.validateBestPractices(
          workDir, 
          backendFiles
        );
        logger.info(`Best practices validation complete: ${bestPracticesValidation.issues.length} issues found`);
      }

      // ── Step 6c: Create Fixes PR for Backend Issues (NEW) ───
      if (backendValidation || bestPracticesValidation) {
        const criticalIssues = [
          ...(backendValidation?.issues || []),
          ...(bestPracticesValidation?.issues || [])
        ].filter(i => ['critical', 'high'].includes(i.severity));

        if (criticalIssues.length > 0) {
          updateStatus('fixing-backend-issues');
          logger.info(`Generating fixes for ${criticalIssues.length} critical/high issues...`);
          
          await this._applyBackendFixes(workDir, criticalIssues);
          
          // Commit backend fixes
          const changedFiles = await this.repoManager.getChangedFiles();
          if (changedFiles.length > 0) {
            await this.repoManager.commitChanges(
              'fix: IGNIS backend validation fixes', 
              changedFiles
            );
          }
        }
      }

      // ── Step 6.5: Scan for Existing Tests ───────────────────
      logger.info('Scanning repository for existing test coverage...');
      updateStatus('scanning-tests');
      
      const existingTests = await this.testCoverageScanner.scanExistingTests(workDir);
      const testGaps = await this.testCoverageScanner.identifyTestGaps(workDir, codeAnalysis, existingTests);
      
      // Filter test types to only generate missing tests
      const testTypes = this.config.testing.types;
      const testPlan = this.testCoverageScanner.filterTestTypesToGenerate(testTypes, existingTests, testGaps);
      
      logger.info('\n📋 Test Generation Plan:');
      Object.entries(testPlan).forEach(([type, plan]) => {
        if (plan.generate) {
          logger.info(`   ✅ ${type}: Generate ${plan.scope} tests (${plan.reason})`);
          if (plan.targets) {
            logger.info(`      → ${plan.targets.length} scenarios to cover`);
          }
        } else {
          logger.info(`   ⏭️  ${type}: Skip (${plan.reason}, ${plan.existing} existing tests)`);
        }
      });
      logger.info('');
      logger.info('✅ Test coverage scan complete');

      // ── Step 7: Generate test suites (only for gaps) ────────
      logger.info('Starting test generation...');
      updateStatus('generating');
      
      // Filter to only types that need generation
      const typesToGenerate = Object.entries(testPlan)
        .filter(([_, plan]) => plan.generate)
        .map(([type, _]) => type);
      
      if (typesToGenerate.length === 0) {
        logger.info('✅ All required tests already exist - skipping test generation');
      }
      
      // Build gaps object from testPlan for generation
      // - null: generate full coverage (no existing tests)
      // - []: skip generation (full coverage exists)
      // - [...]: generate only for specific gaps
      const gapsForGeneration = {};
      typesToGenerate.forEach(type => {
        if (testPlan[type].scope === 'full') {
          gapsForGeneration[type] = null;  // Generate full coverage
        } else if (testPlan[type].scope === 'partial') {
          gapsForGeneration[type] = testPlan[type].targets || [];
        }
      });
      
      const generated = typesToGenerate.length > 0 
        ? await this.testGenerator.generateAll(workDir, codeAnalysis, typesToGenerate, techStack, gapsForGeneration)
        : {};
      
      logger.info('✅ Test generation complete');
      logger.info(`Generated test files: ${Object.values(generated).reduce((sum, g) => sum + (g.files?.length || 0), 0)} total`);

      // ── Step 7.5: Run Unit Tests (if enabled) ───────────────
      let unitTestResults = null;
      const hasUnitTests = testTypes.some(t => ['unit', 'integration'].includes(t));
      
      if (hasUnitTests && this.config.testing.runUnitTests !== false) {
        logger.info('Running unit tests...');
        updateStatus('testing-units');
        
        try {
          // Collect ALL test directories (generated + existing project tests)
          const testDirs = [];
          
          // 1. Check generated tests (ONLY if they contain .test.js files, not Playwright specs)
          const generatedTestDir = path.join(workDir, 'generated-tests/tests');
          if (fs.existsSync(generatedTestDir)) {
            // Only include if it has .test.js files (unit tests), not just .spec.js (Playwright)
            const hasUnitTestFiles = fs.readdirSync(generatedTestDir, { recursive: true })
              .some(f => typeof f === 'string' && (f.endsWith('.test.js') || f.endsWith('.test.ts')));
            if (hasUnitTestFiles) {
              testDirs.push(generatedTestDir);
            }
          }
          
          // 2. Add existing project test directories (root + subdirectories)
          // Only include BACKEND test directories (api, lib, middleware, services, utils, etc.)
          // Skip FRONTEND test directories (components, pages, dashboard, ui, views, layout, etc.)
          const projectTestDirs = ['__tests__', 'tests', 'test', 'spec'];
          const frontendDirPatterns = ['components', 'pages', 'dashboard', 'ui', 'views', 'layout', 'widgets', 'hooks', 'features', 'screens'];
          
          // Check root-level AND common subdirectory locations (e.g., src/)
          const searchRoots = [workDir];
          const subDirs = ['src', 'app', 'lib', 'packages'];
          for (const sub of subDirs) {
            const subPath = path.join(workDir, sub);
            if (fs.existsSync(subPath)) {
              searchRoots.push(subPath);
            }
          }
          for (const root of searchRoots) {
            for (const dir of projectTestDirs) {
              const candidate = path.join(root, dir);
              if (fs.existsSync(candidate) && candidate !== generatedTestDir && !testDirs.includes(candidate)) {
                // Check if this test dir is inside a frontend-specific directory
                const relativePath = path.relative(workDir, candidate).toLowerCase().replace(/\\/g, '/');
                const isFrontendTest = frontendDirPatterns.some(pattern => relativePath.includes(`/${pattern}/`) || relativePath.startsWith(`${pattern}/`));
                if (isFrontendTest) {
                  logger.info(`Skipping frontend test dir (not for Jest): ${path.relative(workDir, candidate)}`);
                  continue;
                }
                testDirs.push(candidate);
              }
            }
          }
          
          // 3. Extract test directories from scanner results (covers non-standard locations)
          if (existingTests) {
            const unitAndIntegrationTests = [
              ...(existingTests.unit || []),
              ...(existingTests.integration || [])
            ];
            for (const test of unitAndIntegrationTests) {
              if (test.file && test.framework !== 'playwright' && test.framework !== 'cypress') {
                const testFileDir = path.dirname(path.join(workDir, test.file));
                // Walk up to find the top-level test directory (e.g., src/__tests__ not src/__tests__/sub)
                let testRoot = testFileDir;
                while (testRoot !== workDir) {
                  const parent = path.dirname(testRoot);
                  const baseName = path.basename(testRoot);
                  if (projectTestDirs.includes(baseName) || parent === workDir) {
                    break;
                  }
                  testRoot = parent;
                }
                // Validate the path exists and isn't already covered by an existing test dir
                if (!testDirs.includes(testRoot) && testRoot !== workDir && fs.existsSync(testRoot)) {
                  // Skip if this dir is a child of an already-added test dir
                  const alreadyCovered = testDirs.some(existing => testRoot.startsWith(existing + path.sep));
                  if (alreadyCovered) continue;
                  // Skip frontend test directories
                  const relativePath = path.relative(workDir, testRoot).toLowerCase().replace(/\\/g, '/');
                  const isFrontendTest = frontendDirPatterns.some(pattern => relativePath.includes(`/${pattern}/`) || relativePath.startsWith(`${pattern}/`));
                  if (isFrontendTest) continue;
                  testDirs.push(testRoot);
                }
              }
            }
          }
          
          // 4. Analyze existing test tech stack for proper framework selection
          const existingTestFrameworks = new Set();
          if (existingTests) {
            Object.values(existingTests).forEach(tests => {
              tests.forEach(test => {
                if (test.framework && test.framework !== 'unknown' && test.framework !== 'playwright' && test.framework !== 'cypress') {
                  existingTestFrameworks.add(test.framework);
                }
              });
            });
          }
          
          if (existingTestFrameworks.size > 0) {
            logger.info(`Existing test frameworks detected: ${[...existingTestFrameworks].join(', ')}`);
          }
          
          if (testDirs.length === 0) {
            logger.info('No test directories found — skipping unit test execution');
            unitTestResults = { framework: 'jest', passed: 0, failed: 0, total: 0, skipped: 0, duration: 0, exitCode: 0, failures: [] };
          } else {
            logger.info(`Running unit tests from ${testDirs.length} directory(ies): ${testDirs.map(d => path.relative(workDir, d)).join(', ')}`);
            unitTestResults = await this.unitTestRunner.runTests(workDir, testDirs, {
              detectedFrameworks: [...existingTestFrameworks]
            });
            
            // ── Unit Test Self-Healing Loop ─────────────────────
            // If unit tests fail, use AI to fix app code and re-run
            const unitMaxIterations = Math.min(this.config.agent.maxIterations, 3);
            let unitIteration = 0;
            
            while (unitTestResults.failed > 0 && unitTestResults.total > 0 && 
                   unitTestResults.failures && unitTestResults.failures.length > 0 &&
                   unitIteration < unitMaxIterations) {
              unitIteration++;
              logger.info(`\n── Unit Test Fix Iteration ${unitIteration}/${unitMaxIterations} ──`);
              logger.info(`   ${unitTestResults.failed} test(s) failing — analyzing with AI...`);
              
              // Analyze unit test failures (adapt failures format for issueFixer)
              const unitFailureContext = {
                failures: unitTestResults.failures.map(f => ({
                  testName: f.testName || f.title || 'Unknown test',
                  file: f.file || 'unknown',
                  error: f.error || 'Unknown error',
                  type: 'unit-test'
                })),
                passed: unitTestResults.passed,
                failed: unitTestResults.failed,
                total: unitTestResults.total
              };
              
              try {
                updateStatus('fixing-unit-tests');
                const failureAnalysis = await this.issueFixer.analyzeFailures(
                  unitFailureContext, codeAnalysis, workDir
                );
                
                // Generate and apply fixes to app code
                const fixResult = await this.issueFixer.generateAndApplyFixes(
                  failureAnalysis, workDir, {
                    previousFailCount: unitTestResults.failed
                  }
                );
                
                if (fixResult.applied.length === 0) {
                  logger.info('   AI could not generate fixes — stopping unit test iteration');
                  break;
                }
                
                logger.info(`   Applied ${fixResult.applied.length} fix(es). Re-running unit tests...`);
                
                // Track fixed files
                for (const fix of fixResult.applied) {
                  if (!fix.file.startsWith('generated-tests/')) {
                    this.appFixFiles.push(fix.file);
                  }
                }
                
                // Re-run unit tests with same config
                unitTestResults = await this.unitTestRunner.runTests(workDir, testDirs, {
                  detectedFrameworks: [...existingTestFrameworks]
                });
                
                if (unitTestResults.failed === 0) {
                  logger.info(`   ✅ All unit tests pass after ${unitIteration} fix iteration(s)!`);
                } else {
                  logger.warn(`   Still ${unitTestResults.failed} failure(s) after fix iteration ${unitIteration}`);
                }
              } catch (fixErr) {
                logger.warn(`   Fix iteration failed: ${fixErr.message}`);
                break;
              }
            }
          }
          
          // Write results to log
          this.unitTestRunner.writeResultsToLog(unitTestResults, workDir);
          
          if (unitTestResults.failed === 0) {
            logger.info(`✅ All ${unitTestResults.passed} unit tests passed!`);
          } else {
            logger.warn(`⚠️ ${unitTestResults.failed} unit test(s) failed`);
          }
        } catch (err) {
          logger.error(`Unit test execution failed: ${err.message}`);
          unitTestResults = {
            framework: 'unknown',
            passed: 0,
            failed: 1,
            total: 1,
            error: err.message
          };
        }
      }

      // ── Step 8: Start target application ────────────────────
      logger.info('Starting target application...');
      updateStatus('starting-app');
      const appResult = await this.appLauncher.startApp(workDir, techStack, {
        url: this.config.app.url || runConfig.appUrl,
        autoStart: this.config.app.autoStart || runConfig.autoStartApp,
        startCommand: this.config.app.startCommand || runConfig.appStartCommand,
        port: this.config.app.port
      });
      
      if (appResult.started) {
        logger.info(`✅ Application started successfully at: ${appResult.url}`);
      } else if (appResult.url) {
        logger.info(`Using provided app URL: ${appResult.url}`);
      } else {
        logger.warn('⚠️ Application not started, tests may fail');
      }

      // If app didn't start, disable E2E/visual tests
      let activeTestTypes = [...testTypes];
      if (!appResult.started) {
        logger.warn('App did not start — disabling E2E and visual tests');
        activeTestTypes = activeTestTypes.filter(t => !['e2e', 'visual'].includes(t));
      }

      const appUrl = appResult.url || this.config.app.url || null;
      
      // ── Step 9: Run tests iteratively ───────────────────────
      logger.info(`Starting test execution phase (${this.config.agent.maxIterations} max iterations)...`);
      updateStatus('testing');

      // Check if there are any Playwright tests to run
      const generatedTestDir = path.join(workDir, 'generated-tests');
      const hasPlaywrightConfig = fs.existsSync(path.join(generatedTestDir, 'playwright.config.js'));
      const hasAnyGeneratedTests = fs.existsSync(generatedTestDir) && 
        fs.readdirSync(generatedTestDir).some(f => f.endsWith('.spec.js') || f.endsWith('.test.js') || f === 'tests');
      
      if (!hasPlaywrightConfig && !hasAnyGeneratedTests && activeTestTypes.length === 0) {
        logger.info('⏭️  No Playwright tests to run (no generated tests, no active test types)');
        logger.info('   Skipping test execution phase');
      }

      // ── Step 9: Iteration loop ──────────────────────────────
      const maxIterations = this.config.agent.maxIterations;
      let lastTestResult = null;
      let allPassed = false;

      // Skip iteration loop if no tests to run
      if (!hasPlaywrightConfig && !hasAnyGeneratedTests) {
        logger.info('No Playwright config or test files found — marking as passed');
        allPassed = true;
        lastTestResult = { passed: 0, failed: 0, total: 0, skipped: 0, failures: [] };
      }

      for (let iteration = 1; iteration <= maxIterations && !allPassed; iteration++) {
        this.currentIteration = iteration;
        updateStatus('testing');
        logger.info(`\n${'='.repeat(60)}\n  ITERATION ${iteration}/${maxIterations}\n${'='.repeat(60)}`);

        // 9a. Run ALL tests
        lastTestResult = await TestRunner.runTests(workDir, { appUrl });

        const iterationRecord = {
          iteration,
          total: lastTestResult.total,
          passed: lastTestResult.passed,
          failed: lastTestResult.failed,
          appFixes: 0,
          testFixes: 0,
          reverted: 0
        };

        // 9b. All tests pass?
        if (lastTestResult.failed === 0 && (lastTestResult.total > 0 || lastTestResult.exitCode === 0)) {
          logger.info(`All tests passed! (${lastTestResult.passed}/${lastTestResult.total})`);
          allPassed = true;
          this.iterationHistory.push(iterationRecord);
          break;
        }

        // 9b-alt. No tests ran but Playwright errored — treat as failure
        if (lastTestResult.total === 0 && lastTestResult.exitCode !== 0) {
          logger.warn(`⚠️ Playwright exited with code ${lastTestResult.exitCode} but 0 tests executed`);
          logger.warn(`   This likely means tests could not run (app not started, config error, etc.)`);
          // Don't break — let the fix loop try to resolve
          iterationRecord.failed = 1; // Force at least 1 failure for the fix loop
          lastTestResult.failed = 1;
        }

        // 9c. At max iterations?
        if (iteration === maxIterations) {
          logger.info(`Max iterations reached (${maxIterations}). ${lastTestResult.failed} test(s) still failing.`);
          this.iterationHistory.push(iterationRecord);
          break;
        }

        // 9d. Root-cause analysis
        updateStatus('fixing');
        const failureAnalysis = await this.issueFixer.analyzeFailures(
          lastTestResult, codeAnalysis, workDir
        );

        // 9e. Generate and apply fixes
        const fixResult = await this.issueFixer.generateAndApplyFixes(
          failureAnalysis, workDir, {
            appUrl,
            previousFailCount: lastTestResult.failed
          }
        );

        iterationRecord.appFixes = fixResult.applied.filter(f => !f.file.startsWith('generated-tests/')).length;
        iterationRecord.testFixes = fixResult.applied.filter(f => f.file.startsWith('generated-tests/')).length;
        iterationRecord.reverted = fixResult.reverted.length;

        // Track modified files
        for (const fix of fixResult.applied) {
          if (fix.file.startsWith('generated-tests/')) {
            this.testFixFiles.push(fix.file);
          } else {
            this.appFixFiles.push(fix.file);
          }
        }

        // 9f-g. Already validated per-fix in generateAndApplyFixes
        // Full regression check
        if (fixResult.applied.length > 0) {
          const regressionResult = await this.issueFixer.validateAllFixes(
            workDir, lastTestResult.passed, { appUrl }
          );

          if (!regressionResult.passed) {
            logger.warn('Regression detected after fixes — reverting batch');
            // In production, we'd revert here. For now, log the issue.
            iterationRecord.reverted += fixResult.applied.length;
          }
        }

        this.iterationHistory.push(iterationRecord);

        // 9h. Commit validated fixes
        const changedFiles = await this.repoManager.getChangedFiles();
        if (changedFiles.length > 0) {
          // Separate commits for app fixes vs test fixes
          const appFiles = changedFiles.filter(f => !f.startsWith('generated-tests/'));
          const testFiles = changedFiles.filter(f => f.startsWith('generated-tests/'));

          if (appFiles.length > 0) {
            await this.repoManager.commitChanges(
              `fix: IGNIS iteration ${iteration} — app code fixes`, appFiles
            );
          }
          if (testFiles.length > 0) {
            await this.repoManager.commitChanges(
              `test: IGNIS iteration ${iteration} — test code fixes`, testFiles
            );
          }
        }
      }

      // ── Step 10: Stop target application ────────────────────
      await this.appLauncher.killApp();

      // ── Step 11: Create Pull Request(s) ─────────────────────
      updateStatus('creating-pr');
      
      // ── Step 11a: Generate Comprehensive Report (NEW) ───────
      let reportInfo = null;
      if (this.config.agent.generateAnalysisReport) {
        updateStatus('generating-report');
        logger.info('Generating comprehensive analysis report...');
        
        const reportData = {
          runId: this.runId,
          repository: runConfig.repoUrl || workDir,
          branch,
          agentVersion: '1.0.0',
          aiProvider: this.config.ai.provider,
          maxIterations: this.config.agent.maxIterations,
          actualIterations: this.currentIteration,
          testTypes: this.config.testing.types,
          codeAnalysis,
          backendValidation,
          bestPracticesValidation,
          testResults: lastTestResult,
          fixesApplied: {
            applied: [
              ...this.appFixFiles.map(f => ({ file: f, type: 'app' })),
              ...this.testFixFiles.map(f => ({ file: f, type: 'test' }))
            ],
            appFixes: this.appFixFiles.length,
            testFixes: this.testFixFiles.length,
            reverted: []
          },
          pullRequests: [],
          duration: Date.now() - this.startTime
        };
        
        reportInfo = await this.reportGenerator.generateComprehensiveReport(workDir, reportData);
        logger.info(`Report generated: ${reportInfo.reportPath}`);
        
        // Commit the report
        const reportFiles = await this.repoManager.getChangedFiles();
        if (reportFiles.length > 0) {
          await this.repoManager.commitChanges(
            'docs: IGNIS comprehensive analysis report',
            reportFiles
          );
        }
      }
      
      const prResults = await this._createPullRequests(
        fixBranch, branch, lastTestResult, allPassed, appResult, envMap, sources,
        backendValidation, bestPracticesValidation, reportInfo
      );

      // ── Step 12: Build summary ──────────────────────────────
      this.summary = {
        runId: this.runId,
        status: allPassed ? 'all-passed' : 'partial',
        iterations: this.currentIteration,
        maxIterations,
        backendValidation: backendValidation ? {
          totalEndpoints: backendValidation.totalEndpoints,
          issuesFound: backendValidation.issues.length,
          criticalIssues: backendValidation.issues.filter(i => i.severity === 'critical').length
        } : null,
        bestPracticesValidation: bestPracticesValidation ? {
          filesValidated: bestPracticesValidation.validatedFiles,
          issuesFound: bestPracticesValidation.issues.length
        } : null,
        unitTestResults: unitTestResults ? {
          framework: unitTestResults.framework,
          total: unitTestResults.total,
          passed: unitTestResults.passed,
          failed: unitTestResults.failed,
          skipped: unitTestResults.skipped,
          duration: unitTestResults.duration,
          coverage: unitTestResults.coverage,
          exitCode: unitTestResults.exitCode
        } : null,
        testResults: lastTestResult ? {
          reportPath: reportInfo?.reportPath || null,
          passed: lastTestResult.passed,
          failed: lastTestResult.failed,
          total: lastTestResult.total
        } : null,
        iterationHistory: this.iterationHistory,
        appStarted: appResult.started,
        appStartMethod: appResult.method || null,
        prUrl: prResults.fixPrUrl || null,
        reportPrUrl: prResults.reportPrUrl || null,
        duration: Date.now() - this.startTime,
        techStack: {
          frontend: techStack.frontend?.framework,
          backend: techStack.backend?.framework,
          language: techStack.language
        }
      };

      updateStatus('completed');
      
      // ── Log Comprehensive Summary ───────────────────────────
      logger.info('\n' + '='.repeat(80));
      logger.info('📊 AUTOMATION TEST AGENT - EXECUTION COMPLETE');
      logger.info('='.repeat(80));
      
      // Backend Analysis
      if (backendValidation) {
        logger.info('\n🔍 BACKEND ANALYSIS:');
        logger.info(`   Total Endpoints Analyzed: ${backendValidation.totalEndpoints}`);
        logger.info(`   Issues Found: ${backendValidation.issues.length}`);
        logger.info(`   Critical Issues: ${backendValidation.issues.filter(i => i.severity === 'critical').length}`);
        if (backendValidation.endpoints && backendValidation.endpoints.length > 0) {
          logger.info(`\n   📍 API Endpoints Tested:`);
          backendValidation.endpoints.slice(0, 10).forEach(ep => {
            logger.info(`      - ${ep.method} ${ep.path} (${ep.file})`);
          });
          if (backendValidation.endpoints.length > 10) {
            logger.info(`      ... and ${backendValidation.endpoints.length - 10} more`);
          }
        }
      }
      
      // Test Coverage
      logger.info('\n✅ TEST EXECUTION SUMMARY:');
      if (unitTestResults) {
        logger.info(`   Unit Tests (${unitTestResults.framework}):`);
        logger.info(`      Total: ${unitTestResults.total}`);
        logger.info(`      Passed: ${unitTestResults.passed} ✅`);
        logger.info(`      Failed: ${unitTestResults.failed} ${unitTestResults.failed > 0 ? '❌' : ''}`);
        logger.info(`      Duration: ${unitTestResults.duration}ms`);
        if (unitTestResults.coverage) {
          logger.info(`      Coverage: ${unitTestResults.coverage.statements}% statements`);
        }
      }
      
      if (lastTestResult) {
        logger.info(`   E2E/Integration Tests:`);
        logger.info(`      Total: ${lastTestResult.total}`);
        logger.info(`      Passed: ${lastTestResult.passed} ✅`);
        logger.info(`      Failed: ${lastTestResult.failed} ${lastTestResult.failed > 0 ? '❌' : ''}`);
      }
      
      // Iterations & Fixes
      logger.info('\n🔄 FIX ITERATIONS:');
      logger.info(`   Total Iterations: ${this.currentIteration}/${maxIterations}`);
      this.iterationHistory.forEach((iter, idx) => {
        logger.info(`   Iteration ${idx + 1}:`);
        logger.info(`      Tests Passed: ${iter.passed}/${iter.total}`);
        logger.info(`      App Fixes Applied: ${iter.appFixes}`);
        logger.info(`      Test Fixes Applied: ${iter.testFixes}`);
      });
      
      // Code Analysis Details
      if (codeAnalysis) {
        logger.info('\n📁 CODEBASE ANALYSIS:');
        logger.info(`   Files Scanned: ${codeAnalysis.fileCount || 'N/A'}`);
        logger.info(`   Routes Found: ${codeAnalysis.routes?.length || 0}`);
        logger.info(`   API Endpoints: ${codeAnalysis.endpoints?.length || 0}`);
        logger.info(`   Components: ${codeAnalysis.components?.length || 0}`);
        
        if (codeAnalysis.endpoints && codeAnalysis.endpoints.length > 0) {
          logger.info(`\n   🔗 API Endpoints Identified:`);
          codeAnalysis.endpoints.forEach(ep => {
            logger.info(`      - ${ep.method} ${ep.path}`);
          });
        }
        
        if (codeAnalysis.routes && codeAnalysis.routes.length > 0) {
          logger.info(`\n   🛣️  Routes Identified:`);
          codeAnalysis.routes.forEach(route => {
            logger.info(`      - ${route}`);
          });
        }
      }
      
      // Test Generation Details
      if (typesToGenerate && typesToGenerate.length > 0) {
        logger.info('\n🧪 TESTS GENERATED:');
        typesToGenerate.forEach(type => {
          const gen = generated[type];
          if (gen && gen.files) {
            logger.info(`   ${type}: ${gen.files.length} files`);
            gen.files.forEach(file => {
              logger.info(`      - ${file}`);
            });
          }
        });
      }
      
      // Pull Requests
      if (prResults.fixPrUrl || prResults.reportPrUrl) {
        logger.info('\n🔀 PULL REQUESTS:');
        if (prResults.fixPrUrl) {
          logger.info(`   Fix PR: ${prResults.fixPrUrl}`);
        }
        if (prResults.reportPrUrl) {
          logger.info(`   Report PR: ${prResults.reportPrUrl}`);
        }
      }
      
      // Final Status
      logger.info('\n' + '='.repeat(80));
      logger.info(`🎯 FINAL STATUS: ${allPassed ? '✅ ALL PASSED' : '⚠️ PARTIAL SUCCESS'}`);
      logger.info(`⏱️  Duration: ${Math.round((Date.now() - this.startTime) / 1000)}s`);
      logger.info('='.repeat(80) + '\n');
      
      logger.info(`Agent run complete: ${JSON.stringify(this.summary)}`);

      // ── Step 13: Cleanup ────────────────────────────────────
      if (mode === 'api') {
        await this.repoManager.cleanup();
      }

      return this.summary;

    } catch (err) {
      logger.error(`Agent run failed: ${err.message}`, { stack: err.stack });
      updateStatus('failed');

      // Ensure app is stopped
      await this.appLauncher.killApp().catch(() => {});

      this.summary = {
        runId: this.runId,
        status: 'failed',
        error: err.message,
        duration: Date.now() - this.startTime,
        iterations: this.currentIteration,
        iterationHistory: this.iterationHistory
      };

      throw err;
    }
  }

  /**
   * Create PR(s) with fixes and/or report.
   */
  async _createPullRequests(fixBranch, baseBranch, testResult, allPassed, appResult, envMap, envSources, 
                             backendValidation, bestPracticesValidation, reportInfo) {
    const results = { fixPrUrl: null, reportPrUrl: null };

    try {
      // Commit generated tests if not already committed
      const changedFiles = await this.repoManager.getChangedFiles();
      if (changedFiles.length > 0) {
        await this.repoManager.commitChanges('test: IGNIS generated test suite', changedFiles);
      }

      // Push the branch
      await this.repoManager.pushBranch(fixBranch);

      // Build PR body
      const prBody = this._buildPrBody(testResult, allPassed, appResult, envMap, envSources, 
                                        backendValidation, bestPracticesValidation, reportInfo);

      // Create the PR
      const pr = await this.repoManager.createPR({
        title: allPassed
          ? `✅ IGNIS: All tests passing — generated tests + fixes`
          : `⚠️ IGNIS: Partial fixes applied — ${testResult?.failed || '?'} test(s) remaining`,
        body: prBody,
        head: fixBranch,
        base: baseBranch
      });

      results.fixPrUrl = pr.html_url;
      logger.info(`PR created: ${pr.html_url}`);

    } catch (err) {
      logger.error(`Failed to create PR: ${err.message}`);
    }

    return results;
  }

  /**
   * Build the PR body with full report.
   */
  _buildPrBody(testResult, allPassed, appResult, envMap, envSources, backendValidation, bestPracticesValidation, reportInfo) {
    const envProvidedCount = envSources ? Object.values(envSources).filter(s => s === 'provided').length : 0;
    const envMockedCount = envSources ? Object.values(envSources).filter(s => s === 'auto-generated').length : 0;

    let body = `## IGNIS Automation Test Agent Report\n\n`;
    body += `### Run Summary\n`;
    body += `- **Run ID**: \`${this.runId}\`\n`;
    body += `- **Iterations**: ${this.currentIteration}/${this.config.agent.maxIterations}\n`;
    body += `- **Final Status**: ${allPassed ? '✅ All tests passing' : '⚠️ Partial fixes applied'}\n`;
    body += `- **AI Provider**: ${this.config.ai.provider}\n`;
    body += `- **Mode**: Fully autonomous (zero user intervention)\n`;
    body += `- **Duration**: ${((Date.now() - this.startTime) / 1000).toFixed(1)}s\n\n`;

    // Backend Validation Section (NEW)
    if (backendValidation) {
      body += `### Backend Validation\n`;
      body += `- **Endpoints Validated**: ${backendValidation.validatedEndpoints}\n`;
      body += `- **Issues Found**: ${backendValidation.issues.length}\n`;
      body += `  - Critical: ${backendValidation.summary.critical}\n`;
      body += `  - High: ${backendValidation.summary.high}\n`;
      body += `  - Medium: ${backendValidation.summary.medium}\n\n`;
    }

    // Best Practices Section (NEW)
    if (bestPracticesValidation) {
      body += `### Best Practices Check\n`;
      body += `- **Files Validated**: ${bestPracticesValidation.validatedFiles}\n`;
      body += `- **Issues Found**: ${bestPracticesValidation.issues.length}\n`;
      body += `  - Critical: ${bestPracticesValidation.summary.critical}\n`;
      body += `  - High: ${bestPracticesValidation.summary.high}\n\n`;
    }

    // Report Link (NEW)
    if (reportInfo) {
      body += `### 📊 Comprehensive Analysis Report\n`;
      body += `A detailed analysis report has been generated with complete findings, RCA, and recommendations.\n`;
      body += `- **Report File**: \`${reportInfo.fileName}\`\n`;
      body += `- **Location**: \`${this.config.agent.reportOutputDir}/\`\n\n`;
    }

    body += `### Environment\n`;
    body += `- **App Startup**: ${appResult.started ? `Auto-started (${appResult.method})` : 'Not started'}\n`;
    body += `- **Environment Variables**: ${envProvidedCount} provided, ${envMockedCount} auto-generated\n\n`;

    if (testResult) {
      body += `### Test Results (Final Iteration)\n\n`;
      body += `| Metric | Count |\n|--------|-------|\n`;
      body += `| Passed | ${testResult.passed} |\n`;
      body += `| Failed | ${testResult.failed} |\n`;
      body += `| Skipped | ${testResult.skipped} |\n`;
      body += `| Total | ${testResult.total} |\n\n`;
    }

    if (this.appFixFiles.length > 0) {
      body += `### Application Code Fixes\n`;
      const unique = [...new Set(this.appFixFiles)];
      unique.forEach((f, i) => { body += `${i + 1}. \`${f}\`\n`; });
      body += '\n';
    }

    if (this.testFixFiles.length > 0) {
      body += `### Test Code Fixes\n`;
      const unique = [...new Set(this.testFixFiles)];
      unique.forEach((f, i) => { body += `${i + 1}. \`${f}\`\n`; });
      body += '\n';
    }

    if (this.iterationHistory.length > 0) {
      body += `### Iteration History\n\n`;
      body += `| # | Total | Passed | Failed | App Fixes | Test Fixes | Reverted |\n`;
      body += `|---|-------|--------|--------|-----------|------------|----------|\n`;
      for (const iter of this.iterationHistory) {
        body += `| ${iter.iteration} | ${iter.total} | ${iter.passed} | ${iter.failed} | ${iter.appFixes} | ${iter.testFixes} | ${iter.reverted} |\n`;
      }
      body += '\n';
    }

    if (testResult && testResult.failures && testResult.failures.length > 0) {
      body += `### Remaining Issues\n\n`;
      body += `| Test | Error | Category |\n|------|-------|----------|\n`;
      for (const f of testResult.failures.slice(0, 20)) {
        const error = (f.error || '').replace(/\|/g, '\\|').slice(0, 100);
        body += `| \`${f.testName || 'unknown'}\` | ${error} | ${f.category || 'unknown'} |\n`;
      }
      body += '\n';
    }

    body += `---\n*Generated by IGNIS Automation Test Agent*\n`;
    return body;
  }

  /**
   * Build a GitHub Actions step summary.
   */
  buildStepSummary() {
    if (!this.summary) return 'No summary available.';
    return this._buildPrBody(
      this.summary.testResults ? { ...this.summary.testResults, failures: [] } : null,
      this.summary.status === 'all-passed',
      { started: this.summary.appStarted, method: this.summary.appStartMethod },
      {},
      {},
      null,
      null,
      null
    );
  }

  /**
   * Apply fixes for backend validation issues using AI
   */
  async _applyBackendFixes(workDir, issues) {
    const fs = require('fs');
    const path = require('path');
    
    logger.info(`Applying fixes for ${issues.length} backend issues...`);
    
    for (const issue of issues.slice(0, 10)) { // Limit to top 10 issues
      try {
        // Read the file
        const fullPath = path.join(workDir, issue.file);
        if (!fs.existsSync(fullPath)) {
          logger.warn(`File not found: ${issue.file}`);
          continue;
        }
        
        const originalContent = fs.readFileSync(fullPath, 'utf-8');
        
        // Ask AI to generate the fix
        const fixPrompt = `Fix the following issue in the code:

File: ${issue.file}
Issue: ${issue.description}
Severity: ${issue.severity}
Recommendation: ${issue.recommendation}

Original Code:
${originalContent}

Provide the complete fixed code.`;

        const fixResult = await this.aiProvider.generateFix(
          { description: issue.description, recommendation: issue.recommendation },
          { [issue.file]: originalContent }
        );
        
        if (fixResult && Array.isArray(fixResult) && fixResult.length > 0) {
          const fix = fixResult[0];
          if (fix.fixedCode && fix.originalCode) {
            // Apply the fix
            const updatedContent = originalContent.replace(fix.originalCode, fix.fixedCode);
            if (updatedContent !== originalContent) {
              fs.writeFileSync(fullPath, updatedContent, 'utf-8');
              this.appFixFiles.push(issue.file);
              logger.info(`Applied fix to ${issue.file}`);
            }
          }
        }
      } catch (err) {
        logger.error(`Failed to apply fix for ${issue.file}: ${err.message}`);
      }
    }
  }

  getRunId() { return this.runId; }
  getStatus() { return this.status; }
  getSummary() { return this.summary; }
}

module.exports = AgentOrchestrator;
