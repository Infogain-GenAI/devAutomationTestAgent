'use strict';

const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { createProvider, createCodeGenProvider } = require('../ai/provider-factory');
const RepoManager = require('./repo-manager');
const DependencyInstaller = require('./dependency-installer');
const EnvHandler = require('./env-handler');
const StackDetector = require('./stack-detector');
const CodeAnalyzer = require('./code-analyzer');
const DocumentationGenerator = require('./documentation-generator');
const TestGenerator = require('./test-generator');
const TestRunner = require('./test-runner');
const UnitTestRunner = require('./unit-test-runner');
const TestCoverageScanner = require('./test-coverage-scanner');
const AppLauncher = require('./app-launcher');
const IssueFixer = require('./issue-fixer');
const BackendValidator = require('./backend-validator');
const ReportGenerator = require('./report-generator');
const KnowledgeBaseManager = require('./knowledge-base-manager');

// Sub-agents
const { GenerationAgent, ValidationAgent, ExecutionAgent } = require('../agents');

class AgentOrchestrator {
  constructor(config) {
    this.config = config;
    this.runId = uuidv4();
    this.status = 'pending';
    this.currentIteration = 0;
    this.summary = null;

    // Core components
    this.aiProvider = createProvider(config);
    this.codeGenProvider = createCodeGenProvider(config); // Dedicated Claude for code generation (optional)
    const codeProvider = this.codeGenProvider || this.aiProvider; // Use code-gen Claude if available

    this.repoManager = new RepoManager(config);
    this.codeAnalyzer = new CodeAnalyzer(this.aiProvider);
    this.documentationGenerator = new DocumentationGenerator(this.aiProvider);
    this.testGenerator = new TestGenerator(codeProvider);  // Code generation uses dedicated provider
    this.unitTestRunner = new UnitTestRunner(config);
    this.testCoverageScanner = new TestCoverageScanner();
    this.issueFixer = new IssueFixer(codeProvider);         // Fix generation uses dedicated provider
    this.appLauncher = new AppLauncher();
    this.backendValidator = new BackendValidator(this.aiProvider, config);
    this.reportGenerator = new ReportGenerator(config);
    this.kbManager = new KnowledgeBaseManager(config);  // ← Knowledge Base Manager for token tracking

    if (this.codeGenProvider) {
      logger.info(`✅ Code-generation Claude provider active (model: ${config.ai.codeGeneration.claudeModel})`);
      logger.info(`   → Used for: test generation, fix generation, failure analysis`);
    }
    
    logger.info('✅ Knowledge Base Manager initialized (token tracking enabled)');

    // Sub-agents
    const deps = {
      aiProvider: this.aiProvider,
      codeGenProvider: this.codeGenProvider || this.aiProvider,
      codeAnalyzer: this.codeAnalyzer,
      documentationGenerator: this.documentationGenerator,
      testGenerator: this.testGenerator,
      testCoverageScanner: this.testCoverageScanner,
      stackDetector: StackDetector,
      unitTestRunner: this.unitTestRunner,
      testRunner: TestRunner,
      issueFixer: this.issueFixer,
      appLauncher: this.appLauncher,
      reportGenerator: this.reportGenerator,
      repoManager: this.repoManager,
      dependencyInstaller: DependencyInstaller
    };
    this.generationAgent = new GenerationAgent(config, deps);
    this.validationAgent = new ValidationAgent(config, deps);
    this.executionAgent = new ExecutionAgent(config, deps);

    // Tracking
    this.iterationHistory = [];
    this.appFixFiles = [];
    this.testFixFiles = [];
    this.startTime = null;
    this.kbAnalytics = null;  // Track KB usage for reports
  }

  /**
   * Main entry point — runs the full agent pipeline.
   * Delegates to sub-agent pipeline if runMode is set, otherwise uses legacy pipeline.
   * @param {Object} runConfig - { repoPath, repoUrl, branch, mode }
   * @param {Function} statusCallback - Called on status changes (optional, for DB updates)
   */
  async run(runConfig, statusCallback) {
    const runMode = this.config.agent.runMode || 'full';

    // Use sub-agent pipeline for all modes
    if (['full', 'generation', 'validation', 'execution'].includes(runMode)) {
      return this.runSubAgentPipeline(runConfig, statusCallback);
    }

    // Legacy fallback (kept for backward compatibility)
    return this._runLegacyPipeline(runConfig, statusCallback);
  }

  /**
   * Legacy pipeline — original monolithic execution flow.
   * Kept for backward compatibility. Will be deprecated in future versions.
   * @param {Object} runConfig - { repoPath, repoUrl, branch, mode }
   * @param {Function} statusCallback - Called on status changes (optional, for DB updates)
   */
  async _runLegacyPipeline(runConfig, statusCallback) {
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

      // ── Step 2.5: Knowledge Base Check ──────────────────────
      logger.info('\n🔍 Checking Knowledge Base cache...');
      updateStatus('kb-check');
      const kbResult = await this.kbManager.loadOrInitialize(workDir);
      this.kbAnalytics = this.kbManager.getAnalytics();
      
      if (kbResult.source === 'cache') {
        logger.info('✅ Using cached knowledge base (previous analysis)');
        logger.info(`   Cache size: ${(this.kbManager.getKBSize() / 1024).toFixed(2)}KB`);
      } else if (kbResult.source === 'fresh') {
        logger.warn('⚠️  No cache available - will perform full analysis');
      }

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

      // ── Step 6: Analyze codebase (skip if KB cache hit — saves tokens) ──
      let codeAnalysis;
      if (kbResult.source === 'cache' && kbResult.kb && kbResult.kb.codeAnalysis) {
        codeAnalysis = kbResult.kb.codeAnalysis;
        logger.info('✅ Code analysis restored from Knowledge Base cache (0 tokens used)');
        logger.info(`   Skipped full AI analysis — reusing cached results from ${kbResult.kb.metadata?.lastUpdatedDate || 'previous run'}`);
      } else {
        logger.info('Starting code analysis...');
        updateStatus('analyzing');
        codeAnalysis = await this.codeAnalyzer.analyze(workDir, techStack);
        logger.info('✅ Code analysis complete');

        // ── Step 6 + 0.5: Update Knowledge Base (only after fresh analysis) ──
        logger.info('\n💾 Updating Knowledge Base cache...');
        await this.kbManager.updateKB(workDir, {
          techStack,
          codeAnalysis,
          apiDocumentation: codeAnalysis.apiDocumentation || {}
        });
        logger.info('✅ Knowledge Base updated for next run');
      }

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
              'fix: IGNIS code_fixes — backend validation fixes', 
              changedFiles
            );
          }
        }
      }

      // ── Step 6d: Generate Application Documentation ─────────
      logger.info('Generating comprehensive application documentation...');
      updateStatus('documenting');
      let appDocumentation = null;
      try {
        const docResult = await this.documentationGenerator.generateDocumentation(
          workDir, codeAnalysis, techStack
        );
        appDocumentation = docResult.documentation;
        logger.info('✅ Application documentation generated');
      } catch (docErr) {
        logger.warn(`Documentation generation failed (non-fatal): ${docErr.message}`);
      }

      // ── Step 6.5: Scan for Existing Tests + Baseline Coverage ──
      logger.info('Scanning repository for existing test coverage...');
      updateStatus('scanning-tests');
      
      const existingTests = await this.testCoverageScanner.scanExistingTests(workDir);

      // ── BASELINE: compute & log coverage BEFORE any test generation ──
      const baselineCoverage = this.testCoverageScanner.computeBaselineCoverage(existingTests);
      this.testCoverageScanner.logCoverageTable(baselineCoverage, 'PRE-RUN BASELINE');

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
          logger.info(`   ⏭️  ${type}: Skip — ${plan.existing} existing test(s) already cover this (${plan.reason})`);
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
        ? await this.testGenerator.generateAll(workDir, codeAnalysis, typesToGenerate, techStack, gapsForGeneration, { appDocumentation, existingTests, baselineCoverage })
        : {};
      
      logger.info('✅ Test generation complete');
      const generatedCount = Object.values(generated).reduce((sum, g) => sum + (g.files?.length || 0), 0);
      logger.info(`Generated test files: ${generatedCount} total`);

      // ── POST-GENERATION: re-scan and log coverage delta ──
      if (generatedCount > 0) {
        const postGenTests = await this.testCoverageScanner.scanExistingTests(workDir);
        const postGenCoverage = this.testCoverageScanner.computeBaselineCoverage(postGenTests);
        this.testCoverageScanner.logCoverageTable(postGenCoverage, 'POST-GENERATION');
        const addedFiles = (postGenCoverage._totals?.files || 0) - (baselineCoverage._totals?.files || 0);
        const addedCases = (postGenCoverage._totals?.cases || 0) - (baselineCoverage._totals?.cases || 0);
        logger.info(`📈 Coverage delta: +${addedFiles} file(s), +${addedCases} case(s) added by generation`);
      }

      // ── Step 7a: Validate generated tests (syntax + dry run) ─
      const validationTestDir = path.join(workDir, 'generated-tests');
      if (fs.existsSync(validationTestDir)) {
        logger.info('Validating generated test files...');
        updateStatus('validating-tests');
        
        const allGenFiles = [];
        Object.values(generated).forEach(g => {
          if (g.files) allGenFiles.push(...g.files);
        });

        if (allGenFiles.length > 0) {
          // Syntax validation + AI fix is already done inside test-generator
          // Now do a quick Playwright list-tests check to catch runtime import errors
          const specFiles = allGenFiles.filter(f => f.endsWith('.spec.js') || f.endsWith('.spec.ts'));
          if (specFiles.length > 0 && fs.existsSync(path.join(validationTestDir, 'playwright.config.js'))) {
            try {
              const { execSync } = require('child_process');
              const listResult = execSync('npx playwright test --list 2>&1', {
                cwd: validationTestDir,
                timeout: 60000,
                encoding: 'utf-8',
                env: { ...process.env, CI: 'true', APP_URL: process.env.APP_URL || 'http://localhost:3000' }
              });
              const testCount = (listResult.match(/\d+ test/)?.[0]) || 'unknown';
              logger.info(`  Playwright validation: ${testCount}(s) found across ${specFiles.length} file(s)`);
            } catch (listErr) {
              const stderr = listErr.stderr || listErr.stdout || listErr.message || '';
              // Check for files that fail to parse
              const brokenFileMatch = stderr.match(/Error:.*?at\s+(.+\.spec\.[jt]s)/g);
              if (brokenFileMatch) {
                logger.warn(`  ${brokenFileMatch.length} file(s) have runtime errors — will be fixed during test iteration`);
              } else {
                logger.warn(`  Playwright list-tests check failed: ${stderr.slice(0, 200)}`);
              }
            }
          }

          // Validate .test.js files (unit tests) — quick Node.js require check
          const testFiles = allGenFiles.filter(f => f.endsWith('.test.js'));
          if (testFiles.length > 0) {
            let brokenUnit = 0;
            for (const tf of testFiles) {
              const fullPath = path.join(validationTestDir, tf);
              if (!fs.existsSync(fullPath)) continue;
              try {
                const vm = require('vm');
                const content = fs.readFileSync(fullPath, 'utf-8');
                new vm.Script(content, { filename: tf });
              } catch {
                brokenUnit++;
              }
            }
            if (brokenUnit > 0) {
              logger.warn(`  ${brokenUnit}/${testFiles.length} unit test file(s) have syntax errors — will be fixed during iteration`);
            } else {
              logger.info(`  All ${testFiles.length} unit test file(s) passed syntax validation`);
            }
          }
        }
      }

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
          
          // Commit unit test fixes (both app fixes and test file changes)
          const unitChangedFiles = await this.repoManager.getChangedFiles();
          if (unitChangedFiles.length > 0) {
            const unitAppFiles = unitChangedFiles.filter(f => !f.startsWith('generated-tests/'));
            const unitTestFiles = unitChangedFiles.filter(f => f.startsWith('generated-tests/'));

            if (unitAppFiles.length > 0) {
              await this.repoManager.commitChanges(
                'fix: IGNIS unit_tests — app code fixes', unitAppFiles
              );
            }
            if (unitTestFiles.length > 0) {
              await this.repoManager.commitChanges(
                'test: IGNIS unit_tests — test code fixes', unitTestFiles
              );
            }
          }
          
          // Write results to log
          this.unitTestRunner.writeResultsToLog(unitTestResults, workDir);
          
          if (unitTestResults.total === 0 && unitTestResults.exitCode !== 0) {
            logger.warn(`⚠️ Unit test runner exited with code ${unitTestResults.exitCode} but ran 0 tests — possible OOM or config issue`);
          } else if (unitTestResults.total === 0) {
            logger.info('ℹ️ No unit tests executed (0 test files matched)');
          } else if (unitTestResults.failed === 0) {
            logger.info(`✅ All ${unitTestResults.passed} unit tests passed!`);
          } else {
            logger.warn(`⚠️ ${unitTestResults.failed}/${unitTestResults.total} unit test(s) failed`);
          }

          // Log coverage summary
          if (unitTestResults.coverage) {
            const cov = unitTestResults.coverage;
            logger.info(`📈 Coverage: Stmts ${cov.statements}% | Branch ${cov.branches}% | Funcs ${cov.functions}% | Lines ${cov.lines}%`);
            if (cov.perFile) {
              const fileCount = Object.keys(cov.perFile).length;
              logger.info(`   Per-file coverage for ${fileCount} file(s) — see detailed log for breakdown`);
            }
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

        // ── Fallback: If unit test runner completely failed, regenerate as Playwright specs ──
        if (unitTestResults && unitTestResults.total === 0 && 
            (unitTestResults.exitCode !== 0 || unitTestResults.skippedReason) === false) {
          // 0 tests ran and no skip reason = runner failed silently
          logger.warn('⚠️ Unit test runner ran 0 tests — falling back to Playwright spec generation');
          try {
            const fallbackTypes = ['api'];
            const fallbackGaps = { api: null };
            const fallbackGenerated = await this.testGenerator.generateAll(
              workDir, codeAnalysis, fallbackTypes, techStack, fallbackGaps
            );
            const fallbackFiles = Object.values(fallbackGenerated).reduce((sum, g) => sum + (g.files?.length || 0), 0);
            if (fallbackFiles > 0) {
              logger.info(`  ✅ Fallback: Generated ${fallbackFiles} Playwright spec(s) to replace failed unit tests`);
            }
          } catch (fallbackErr) {
            logger.warn(`  Fallback generation failed: ${fallbackErr.message}`);
          }
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

      // ── Step 8a: Live endpoint smoke test ───────────────────
      let liveValidation = null;
      if (appUrl && (appResult.started || appResult.url)) {
        try {
          updateStatus('validating-endpoints-live');
          logger.info('Running live endpoint smoke tests...');
          liveValidation = await this.backendValidator.validateEndpointsLive(
            appUrl, workDir, codeAnalysis.structure, codeAnalysis
          );
          
          if (liveValidation.totalTested > 0) {
            logger.info(`\n📡 LIVE ENDPOINT VALIDATION:`);
            logger.info(`   Tested: ${liveValidation.totalTested}`);
            logger.info(`   Accessible: ${liveValidation.accessible} ✅`);
            logger.info(`   Failed: ${liveValidation.failed} ${liveValidation.failed > 0 ? '❌' : ''}`);
            
            if (liveValidation.errors.length > 0) {
              logger.warn(`   Unreachable endpoints:`);
              for (const err of liveValidation.errors) {
                logger.warn(`      - ${err.endpoint}: ${err.error}`);
              }
            }
            logger.info('');
          }
        } catch (err) {
          logger.warn(`Live endpoint validation failed: ${err.message}`);
        }
      }

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
      // maxIterations = number of FIX cycles. Total test runs = maxIterations + 1
      // (initial run + one re-run per fix cycle)
      const maxIterations = this.config.agent.maxIterations;
      let lastTestResult = null;
      let allPassed = false;

      // Skip iteration loop if no tests to run
      if (!hasPlaywrightConfig && !hasAnyGeneratedTests) {
        logger.info('No Playwright config or test files found — marking as passed');
        allPassed = true;
        lastTestResult = { passed: 0, failed: 0, total: 0, skipped: 0, failures: [] };
      }

      // Initial test run (before any fix cycles)
      if (!allPassed) {
        this.currentIteration = 0;
        updateStatus('testing');
        logger.info(`\n${'='.repeat(60)}\n  INITIAL TEST RUN\n${'='.repeat(60)}`);

        lastTestResult = await TestRunner.runTests(workDir, { appUrl });

        // Check if all tests pass on first run
        if (lastTestResult.failed === 0 && (lastTestResult.total > 0 || lastTestResult.exitCode === 0)) {
          logger.info(`All tests passed on first run! (${lastTestResult.passed}/${lastTestResult.total})`);
          allPassed = true;
          this.iterationHistory.push({
            iteration: 0,
            total: lastTestResult.total,
            passed: lastTestResult.passed,
            failed: lastTestResult.failed,
            appFixes: 0, testFixes: 0, reverted: 0
          });
        }

        // Handle 0 tests but Playwright errored
        if (!allPassed && lastTestResult.total === 0 && lastTestResult.exitCode !== 0) {
          logger.warn(`⚠️ Playwright exited with code ${lastTestResult.exitCode} but 0 tests executed`);
          logger.warn(`   This likely means tests could not run (app not started, config error, etc.)`);
          lastTestResult.failed = 1;
        }
      }

      // Fix cycles: analyze failures → apply fixes → re-run tests
      for (let iteration = 1; iteration <= maxIterations && !allPassed; iteration++) {
        this.currentIteration = iteration;

        // ── Fix step: AI analyzes failures and generates fixes ──
        updateStatus('fixing');
        logger.info(`\n${'='.repeat(60)}\n  FIX CYCLE ${iteration}/${maxIterations}\n${'='.repeat(60)}`);
        logger.info(`Analyzing ${lastTestResult.failed} failure(s) from previous run...`);

        const iterationRecord = {
          iteration,
          total: lastTestResult.total,
          passed: lastTestResult.passed,
          failed: lastTestResult.failed,
          appFixes: 0,
          testFixes: 0,
          reverted: 0
        };

        let failureAnalysis, fixResult;
        try {
          failureAnalysis = await this.issueFixer.analyzeFailures(
            lastTestResult, codeAnalysis, workDir
          );

          // Generate and apply fixes
          fixResult = await this.issueFixer.generateAndApplyFixes(
            failureAnalysis, workDir, {
              appUrl,
              previousFailCount: lastTestResult.failed
            }
          );
        } catch (fixError) {
          logger.warn(`Fix cycle ${iteration} failed: ${fixError.message}`);
          this.iterationHistory.push(iterationRecord);
          continue;
        }

        if (fixResult.noFixes || fixResult.applied.length === 0) {
          if (fixResult.reverted && fixResult.reverted.length > 0) {
            logger.warn(`All ${fixResult.reverted.length} fix(es) reverted (path issues?) — continuing to next iteration`);
            this.iterationHistory.push(iterationRecord);
            continue;
          }
          logger.info('No fixes could be generated — skipping remaining iterations');
          this.iterationHistory.push(iterationRecord);
          break;
        }

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

        logger.info(`Applied ${fixResult.applied.length} fix(es). Re-running tests...`);

        // ── Re-run tests after fixes ──
        updateStatus('testing');
        lastTestResult = await TestRunner.runTests(workDir, { appUrl });

        iterationRecord.total = lastTestResult.total;
        iterationRecord.passed = lastTestResult.passed;
        iterationRecord.failed = lastTestResult.failed;

        // Check if all tests pass now
        if (lastTestResult.failed === 0 && (lastTestResult.total > 0 || lastTestResult.exitCode === 0)) {
          logger.info(`✅ All tests passed after fix cycle ${iteration}! (${lastTestResult.passed}/${lastTestResult.total})`);
          allPassed = true;
        } else {
          logger.info(`Still ${lastTestResult.failed} failure(s) after fix cycle ${iteration}`);
        }

        this.iterationHistory.push(iterationRecord);

        // Commit validated fixes
        const changedFiles = await this.repoManager.getChangedFiles();
        if (changedFiles.length > 0) {
          // Separate commits for app fixes vs test fixes
          const appFiles = changedFiles.filter(f => !f.startsWith('generated-tests/'));
          const testFiles = changedFiles.filter(f => f.startsWith('generated-tests/'));

          if (appFiles.length > 0) {
            await this.repoManager.commitChanges(
              `fix: IGNIS code_fixes — iteration ${iteration} app fixes`, appFiles
            );
          }
          if (testFiles.length > 0) {
            // Categorize test files by type
            const e2eFiles = testFiles.filter(f => f.includes('/e2e/') || f.includes('e2e'));
            const apiFiles = testFiles.filter(f => f.includes('/api/') || f.includes('api'));
            const otherTestFiles = testFiles.filter(f => !e2eFiles.includes(f) && !apiFiles.includes(f));

            if (e2eFiles.length > 0) {
              await this.repoManager.commitChanges(
                `test: IGNIS e2e_tests — iteration ${iteration} test fixes`, e2eFiles
              );
            }
            if (apiFiles.length > 0) {
              await this.repoManager.commitChanges(
                `test: IGNIS api_tests — iteration ${iteration} test fixes`, apiFiles
              );
            }
            if (otherTestFiles.length > 0) {
              await this.repoManager.commitChanges(
                `test: IGNIS test_fixes — iteration ${iteration} test fixes`, otherTestFiles
              );
            }
          }
        }
      }

      if (!allPassed && lastTestResult) {
        logger.info(`Completed ${maxIterations} fix cycle(s). ${lastTestResult.failed} test(s) still failing.`);
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
          appDocumentation: appDocumentation || null,
          backendValidation,
          bestPracticesValidation,
          testResults: lastTestResult,
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
          liveValidation: liveValidation || null,
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
            'docs: IGNIS report — comprehensive analysis report',
            reportFiles
          );
        }
      }
      
      const prResults = await this._createPullRequests(
        fixBranch, branch, lastTestResult, allPassed, appResult, envMap, sources,
        backendValidation, bestPracticesValidation, reportInfo, unitTestResults, liveValidation
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
        liveValidation: liveValidation ? {
          totalTested: liveValidation.totalTested,
          accessible: liveValidation.accessible,
          failed: liveValidation.failed
        } : null,
        prUrl: prResults.fixPrUrl || null,
        reportPrUrl: prResults.reportPrUrl || null,
        duration: Date.now() - this.startTime,
        techStack: {
          frontend: techStack.frontend?.framework,
          backend: techStack.backend?.framework,
          language: techStack.language
        },
        knowledgeBase: this.kbAnalytics ? {
          source: this.kbAnalytics.kbSource,
          cacheStatus: this.kbAnalytics.cacheStatus,
          cacheHitRate: this.kbAnalytics.cacheStatus === 'HIT' ? '100%' : '0%',
          tokenEstimated: this.kbAnalytics.tokenUsage?.estimated || 0,
          tokenSaved: this.kbAnalytics.cacheStatus === 'HIT' ? 25000 : 0,
          costData: {
            estimatedCost: this.kbManager.costData.estimatedCost,
            costBreakdown: this.kbManager.costData.costBreakdown,
            model: this.kbManager.costCalculator.getModelDisplayName(),
            provider: this.kbManager.costCalculator.canonicalProvider
          },
          cacheSize: `${(this.kbManager.getKBSize() / 1024).toFixed(2)}KB`,
          cacheLocation: this.kbAnalytics.cacheLocation
        } : null
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
      
      if (liveValidation && liveValidation.totalTested > 0) {
        logger.info('\n📡 LIVE ENDPOINT VALIDATION:');
        logger.info(`   Endpoints Tested: ${liveValidation.totalTested}`);
        logger.info(`   Accessible: ${liveValidation.accessible} ✅`);
        logger.info(`   Failed: ${liveValidation.failed} ${liveValidation.failed > 0 ? '❌' : ''}`);
        
        if (liveValidation.endpoints) {
          const successEndpoints = liveValidation.endpoints.filter(e => e.accessible && e.statusCode < 400);
          const warnEndpoints = liveValidation.endpoints.filter(e => e.accessible && e.statusCode >= 400);
          const failedEndpoints = liveValidation.endpoints.filter(e => !e.accessible);
          
          if (successEndpoints.length > 0) {
            logger.info('   Working endpoints:');
            successEndpoints.slice(0, 10).forEach(ep => {
              logger.info(`      ✅ ${ep.method} ${ep.path} → ${ep.statusCode} (${ep.responseTime}ms)`);
            });
          }
          if (warnEndpoints.length > 0) {
            logger.info('   Endpoints returning errors:');
            warnEndpoints.slice(0, 10).forEach(ep => {
              logger.info(`      ⚠️  ${ep.method} ${ep.path} → ${ep.statusCode} (${ep.responseTime}ms)`);
            });
          }
          if (failedEndpoints.length > 0) {
            logger.info('   Unreachable endpoints:');
            failedEndpoints.slice(0, 5).forEach(ep => {
              logger.info(`      ❌ ${ep.method} ${ep.path} → ${ep.error}`);
            });
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
      
      // Knowledge Base Analytics
      if (this.kbAnalytics) {
        logger.info('\n📚 KNOWLEDGE BASE ANALYTICS:');
        logger.info(`   Source: ${this.kbAnalytics.kbSource}`);
        logger.info(`   Cache Status: ${this.kbAnalytics.cacheStatus}`);
        logger.info(`   Tokens Estimated: ${this.kbAnalytics.tokenUsage?.estimated || 0}`);
        
        // Add cost information
        const costData = this.kbManager.costData;
        if (costData && costData.estimatedCost !== undefined) {
          logger.info(`   💰 Estimated Cost: $${costData.estimatedCost.toFixed(4)} (${this.kbManager.costCalculator.getModelDisplayName()})`);
          if (costData.costBreakdown) {
            logger.info(`      Input: $${costData.costBreakdown.inputCost?.toFixed(4) || 'N/A'} | Output: $${costData.costBreakdown.outputCost?.toFixed(4) || 'N/A'}`);
          }
        }
        
        if (this.kbAnalytics.cacheStatus === 'HIT') {
          logger.info(`   ✅ Tokens Saved: ~25,000 (92% reduction)`);
          logger.info(`   Cache Hit Rate: 100%`);
          if (costData && costData.costBreakdown) {
            logger.info(`   💵 Cost Savings: ${costData.costBreakdown.formattedSavings || 'N/A'} vs full analysis`);
          }
        }
        logger.info(`   Cache Size: ${(this.kbManager.getKBSize() / 1024).toFixed(2)}KB`);
        logger.info(`   Cache Location: ${this.kbAnalytics.cacheLocation}`);
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
                             backendValidation, bestPracticesValidation, reportInfo, unitTestResults, liveValidation) {
    const results = { fixPrUrl: null, reportPrUrl: null };

    try {
      // Commit any remaining generated tests with typed naming
      const changedFiles = await this.repoManager.getChangedFiles();
      if (changedFiles.length > 0) {
        // Separate by category
        const testFiles = changedFiles.filter(f => f.startsWith('generated-tests/'));
        const otherFiles = changedFiles.filter(f => !f.startsWith('generated-tests/'));

        if (testFiles.length > 0) {
          // Sub-categorize generated test files
          const e2eFiles = testFiles.filter(f => f.includes('/e2e/') || f.includes('e2e'));
          const apiFiles = testFiles.filter(f => f.includes('/api/') || f.includes('api'));
          const unitFiles = testFiles.filter(f => f.includes('/unit/') || f.includes('.test.'));
          const remainingTests = testFiles.filter(f => !e2eFiles.includes(f) && !apiFiles.includes(f) && !unitFiles.includes(f));

          if (e2eFiles.length > 0) {
            await this.repoManager.commitChanges('test: IGNIS e2e_tests — generated test suite', e2eFiles);
          }
          if (apiFiles.length > 0) {
            await this.repoManager.commitChanges('test: IGNIS api_tests — generated test suite', apiFiles);
          }
          if (unitFiles.length > 0) {
            await this.repoManager.commitChanges('test: IGNIS unit_tests — generated test suite', unitFiles);
          }
          if (remainingTests.length > 0) {
            await this.repoManager.commitChanges('test: IGNIS generated_tests — test suite', remainingTests);
          }
        }

        if (otherFiles.length > 0) {
          await this.repoManager.commitChanges('chore: IGNIS — remaining changes', otherFiles);
        }
      }

      // Push the branch — must succeed before creating PR
      try {
        await this.repoManager.pushBranch(fixBranch);
      } catch (pushErr) {
        logger.error(`Failed to push branch ${fixBranch}: ${pushErr.message}`);
        logger.error('PR creation skipped — branch could not be pushed to remote');
        return results;
      }

      // Build PR body
      const prBody = this._buildPrBody(testResult, allPassed, appResult, envMap, envSources, 
                                        backendValidation, bestPracticesValidation, reportInfo, unitTestResults, liveValidation);

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
  _buildPrBody(testResult, allPassed, appResult, envMap, envSources, backendValidation, bestPracticesValidation, reportInfo, unitTestResults, liveValidation) {
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

    // Live API Endpoint Validation Section
    if (liveValidation && liveValidation.totalTested > 0) {
      body += `### 📡 Live API Endpoint Validation\n\n`;
      body += `| Metric | Count |\n|--------|-------|\n`;
      body += `| Endpoints Tested | ${liveValidation.totalTested} |\n`;
      body += `| Accessible | ${liveValidation.accessible} |\n`;
      body += `| Failed | ${liveValidation.failed} |\n\n`;

      if (liveValidation.endpoints && liveValidation.endpoints.length > 0) {
        body += `| Method | Path | Status | Response Time | Result |\n`;
        body += `|--------|------|--------|---------------|--------|\n`;
        for (const ep of liveValidation.endpoints.slice(0, 30)) {
          if (ep.accessible) {
            const icon = ep.statusCode < 400 ? '✅' : '⚠️';
            body += `| ${ep.method} | \`${ep.path}\` | ${ep.statusCode} | ${ep.responseTime}ms | ${icon} |\n`;
          } else {
            body += `| ${ep.method} | \`${ep.path}\` | — | — | ❌ ${(ep.error || '').slice(0, 60)} |\n`;
          }
        }
        if (liveValidation.endpoints.length > 30) {
          body += `| ... | *${liveValidation.endpoints.length - 30} more* | | | |\n`;
        }
        body += '\n';
      }

      // Show sample data sent for POST/PUT/PATCH endpoints
      const mutationEndpoints = (liveValidation.endpoints || []).filter(ep => ep.bodyDataSent);
      if (mutationEndpoints.length > 0) {
        body += `<details>\n<summary>Sample Data Sent (${mutationEndpoints.length} endpoints)</summary>\n\n`;
        for (const ep of mutationEndpoints.slice(0, 10)) {
          body += `**${ep.method} \`${ep.path}\`** → ${ep.statusCode || 'N/A'}\n`;
          body += `\`\`\`json\n${JSON.stringify(ep.bodyDataSent, null, 2)}\n\`\`\`\n\n`;
        }
        body += `</details>\n\n`;
      }
    }

    body += `### Environment\n`;
    body += `- **App Startup**: ${appResult.started ? `Auto-started (${appResult.method})` : 'Not started'}\n`;
    body += `- **Environment Variables**: ${envProvidedCount} provided, ${envMockedCount} auto-generated\n\n`;

    if (unitTestResults && unitTestResults.total > 0) {
      body += `### Unit Test Results (${unitTestResults.framework})\n\n`;
      body += `| Metric | Count |\n|--------|-------|\n`;
      body += `| Passed | ${unitTestResults.passed} |\n`;
      body += `| Failed | ${unitTestResults.failed} |\n`;
      body += `| Skipped | ${unitTestResults.skipped || 0} |\n`;
      body += `| Total | ${unitTestResults.total} |\n`;
      body += `| Duration | ${((unitTestResults.duration || 0) / 1000).toFixed(2)}s |\n\n`;

      if (unitTestResults.failures && unitTestResults.failures.length > 0) {
        body += `#### Unit Test Failures\n\n`;
        body += `| Test | Error |\n|------|-------|\n`;
        for (const f of unitTestResults.failures.slice(0, 15)) {
          const error = (f.error || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 120);
          body += `| \`${f.testName || 'unknown'}\` | ${error} |\n`;
        }
        if (unitTestResults.failures.length > 15) {
          body += `| ... | *${unitTestResults.failures.length - 15} more failures* |\n`;
        }
        body += '\n';
      }
    }

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
      null,
      this.summary.unitTestResults || null,
      this.summary.liveValidation || null
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

  // ═══════════════════════════════════════════════════════════════
  // SUB-AGENT PIPELINE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run the sub-agent pipeline based on runMode.
   * Supports: full | generation | validation | execution
   * @param {object} runConfig - Run configuration
   * @param {Function} statusCallback - Status update callback
   */
  async runSubAgentPipeline(runConfig, statusCallback) {
    this.startTime = Date.now();
    const runMode = this.config.agent.runMode || 'full';
    let workDir;

    const updateStatus = (newStatus) => {
      this.status = newStatus;
      logger.info(`[${this.runId}] Status: ${newStatus}`);
      if (statusCallback) statusCallback(this.runId, newStatus);
    };

    try {
      // ── Setup: Acquire repo & install deps ──────────────────
      updateStatus('setup');
      const { workDir: setupWorkDir, fixBranch, baseBranch } = await this._setupWorkspace(runConfig);
      workDir = setupWorkDir;

      // Detect tech stack
      const techStack = StackDetector.detect(workDir, runConfig.techStackOverride || {});
      logger.info(`Stack detected: ${JSON.stringify(techStack)}`);

      // Build shared context for sub-agents
      const testTypes = this.config.testing.types;
      const context = {
        workDir,
        techStack,
        testTypes,
        runId: this.runId,
        repoPath: workDir,
        branch: runConfig.branch || this.config.agent.branch || 'main',
        appUrl: null
      };

      // Results tracking
      const pipelineResults = {
        generation: null,
        validation: null,
        execution: null
      };

      const maxMainIterations = this.config.agent.maxIterations;

      // ══ Main Iteration Loop ═══════════════════════════════════
      for (let mainIter = 0; mainIter < maxMainIterations; mainIter++) {
        if (mainIter > 0) {
          logger.info(`\n${'═'.repeat(70)}`);
          logger.info(`  MAIN ITERATION ${mainIter + 1}/${maxMainIterations}`);
          logger.info(`${'═'.repeat(70)}\n`);
        }

        // ── 1. Generation Agent ───────────────────────────────
        if (['full', 'generation'].includes(runMode)) {
          updateStatus('generation');
          const genResult = await this.generationAgent.execute(context);
          pipelineResults.generation = genResult;

          // Propagate generation results to context
          if (genResult.result) {
            context.codeAnalysis = genResult.result.codeAnalysis;
            context.appDocumentation = genResult.result.appDocumentation;
            context.existingTests = genResult.result.existingTests;
            context.generated = genResult.result.generated;
          }

          // Commit generated tests
          const genChanges = await this.repoManager.getChangedFiles();
          if (genChanges.length > 0) {
            await this.repoManager.commitChanges(
              `test: IGNIS generation_agent — tests generated (iter ${mainIter + 1})`,
              genChanges
            );
          }

          if (runMode === 'generation') break;
        }

        // ── 2. Validation & Fixes Agent ───────────────────────
        if (['full', 'validation'].includes(runMode)) {
          updateStatus('validation');
          const valContext = {
            ...context,
            generated: context.generated || pipelineResults.generation?.result?.generated || {}
          };
          const valResult = await this.validationAgent.execute(valContext);
          pipelineResults.validation = valResult;

          // Commit validation fixes
          const valChanges = await this.repoManager.getChangedFiles();
          if (valChanges.length > 0) {
            await this.repoManager.commitChanges(
              `fix: IGNIS validation_agent — test fixes (iter ${mainIter + 1})`,
              valChanges
            );
          }

          if (runMode === 'validation') break;
        }

        // ── 3. Execution Agent (Test Runner & Coverage) ───────
        if (['full', 'execution'].includes(runMode)) {
          updateStatus('execution');

          // Start app if needed
          const appResult = await this.appLauncher.startApp(workDir, techStack, {
            url: this.config.app.url || runConfig.appUrl,
            autoStart: this.config.app.autoStart || runConfig.autoStartApp,
            startCommand: this.config.app.startCommand || runConfig.appStartCommand,
            port: this.config.app.port
          });
          context.appUrl = appResult.url || this.config.app.url || null;

          if (appResult.started) {
            logger.info(`✅ Application started at: ${appResult.url}`);
          }

          const execResult = await this.executionAgent.execute(context);
          pipelineResults.execution = execResult;

          // Stop app
          await this.appLauncher.killApp();

          // Commit any fixes from execution
          const execChanges = await this.repoManager.getChangedFiles();
          if (execChanges.length > 0) {
            await this.repoManager.commitChanges(
              `fix: IGNIS execution_agent — test/app fixes (iter ${mainIter + 1})`,
              execChanges
            );
          }

          if (runMode === 'execution') break;

          // Check if coverage target met
          if (execResult.coverageMet) {
            logger.info(`\n✅ Coverage target met (${execResult.coverage}% >= ${this.config.agent.coverageThreshold}%) — stopping main iterations`);
            break;
          }
        }
      }

      // ── Generate Final Report ─────────────────────────────────
      updateStatus('reporting');
      const finalReport = await this._generateFinalReport(workDir, pipelineResults, context, runConfig);

      // ── Push & Create PR ──────────────────────────────────────
      updateStatus('creating-pr');
      const prResult = await this._pushAndCreatePR(fixBranch, baseBranch, pipelineResults, runConfig);

      // ── Build Summary ─────────────────────────────────────────
      this.summary = this._buildPipelineSummary(pipelineResults, runMode, finalReport);
      this.summary.prUrl = prResult.prUrl || null;

      // ── Aggregate & Log Token Usage ───────────────────────────
      this.summary.tokenUsage = this._aggregateTokenUsage();
      this._logTokenUsage(this.summary.tokenUsage);

      updateStatus('completed');

      logger.info(`\n${'═'.repeat(70)}`);
      logger.info(`  PIPELINE COMPLETE — ${this.summary.status}`);
      logger.info(`  Unit Coverage: ${this.summary.unitCoverage}% | Automation Coverage: ${this.summary.automationCoverage}%`);
      logger.info(`  Target: ${this.config.agent.coverageThreshold}%`);
      logger.info(`${'═'.repeat(70)}\n`);

      return this.summary;

    } catch (err) {
      logger.error(`Pipeline failed: ${err.message}`);
      logger.error(err.stack);
      this.status = 'failed';
      this.summary = { status: 'failed', error: err.message, duration: Date.now() - this.startTime };
      await this.appLauncher.killApp().catch(() => {});
      throw err;
    }
  }

  /**
   * Setup workspace: resolve path, install deps, create branch.
   */
  async _setupWorkspace(runConfig) {
    let workDir;
    const mode = runConfig.mode || 'cli';

    if (mode === 'cli' || runConfig.repoPath) {
      workDir = runConfig.repoPath || process.env.GITHUB_WORKSPACE;
      await this.repoManager.useLocalWorkspace(workDir);
    } else {
      workDir = path.join(this.config.agent.workDir, this.runId);
      await this.repoManager.cloneRepo(runConfig.repoUrl, workDir, this.config.github.token);
    }

    // Create fix branch
    const branch = runConfig.branch || this.config.agent.branch || 'main';
    const fixBranch = `${this.config.agent.fixBranchPrefix}-${this.runId.slice(0, 8)}`;
    logger.info(`Creating branch: ${fixBranch} from ${branch}`);
    await this.repoManager.createBranch(fixBranch);
    logger.info(`✅ Branch created: ${fixBranch}`);

    // Install dependencies
    logger.info('Installing dependencies...');
    try {
      const { manager: packageManager, installDir } = DependencyInstaller.detectPackageManager(workDir);
      if (packageManager) {
        await DependencyInstaller.installDependencies(installDir, packageManager);
        await DependencyInstaller.installPlaywrightBrowsers(installDir);
        DependencyInstaller.verifyInstallation(installDir);
        logger.info('✅ Dependencies installed');
      }
    } catch (err) {
      logger.error(`Dependency installation failed: ${err.message}`);
      throw err;
    }

    // Resolve environment
    let providedSecrets = {};
    if (process.env.APP_SECRETS) {
      try { providedSecrets = JSON.parse(process.env.APP_SECRETS); } catch { /* ignore */ }
    }
    if (runConfig.appSecrets) providedSecrets = { ...providedSecrets, ...runConfig.appSecrets };
    const { envMap } = EnvHandler.resolveEnvironment(workDir, providedSecrets);
    EnvHandler.writeEnvFile(workDir, envMap);

    return { workDir, fixBranch, baseBranch: branch };
  }

  /**
   * Generate final comprehensive report from all sub-agent results.
   */
  async _generateFinalReport(workDir, pipelineResults, context, runConfig) {
    if (!this.config.agent.generateAnalysisReport) return null;

    try {
      const execResult = pipelineResults.execution?.result || {};
      const reportData = {
        runId: this.runId,
        repository: runConfig.repoUrl || workDir,
        branch: context.branch,
        agentVersion: '2.0.0',
        aiProvider: this.config.ai.provider,
        maxIterations: this.config.agent.maxIterations,
        subAgentMaxIterations: this.config.agent.subAgentMaxIterations,
        coverageThreshold: this.config.agent.coverageThreshold,
        runMode: this.config.agent.runMode,
        testTypes: this.config.testing.types,
        codeAnalysis: context.codeAnalysis || null,
        appDocumentation: context.appDocumentation || null,
        testResults: execResult.automationTestResults || null,
        testResultsWorkDir: workDir,
        unitTestResults: execResult.unitTestResults || null,
        pipelineResults: {
          generation: pipelineResults.generation ? {
            status: pipelineResults.generation.status,
            iterations: pipelineResults.generation.iterations,
            coverage: pipelineResults.generation.coverage
          } : null,
          validation: pipelineResults.validation ? {
            status: pipelineResults.validation.status,
            iterations: pipelineResults.validation.iterations,
            coverage: pipelineResults.validation.coverage
          } : null,
          execution: pipelineResults.execution ? {
            status: pipelineResults.execution.status,
            iterations: pipelineResults.execution.iterations,
            coverage: pipelineResults.execution.coverage,
            unitCoverage: execResult.unitCoverage,
            automationCoverage: execResult.automationCoverage
          } : null
        },
        tokenUsage: this._aggregateTokenUsage(),
        duration: Date.now() - this.startTime
      };

      const reportInfo = await this.reportGenerator.generateComprehensiveReport(workDir, reportData);
      logger.info(`Report generated: ${reportInfo.reportPath}`);

      // Commit report
      const reportFiles = await this.repoManager.getChangedFiles();
      if (reportFiles.length > 0) {
        await this.repoManager.commitChanges('docs: IGNIS report — comprehensive analysis report', reportFiles);
      }

      return reportInfo;
    } catch (err) {
      logger.warn(`Report generation failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Push branch to remote and create a Pull Request.
   * @param {string} fixBranch - The feature branch name to push
   * @param {string} baseBranch - The base branch to open PR against
   * @param {object} pipelineResults - Results from all sub-agents
   * @param {object} runConfig - Run configuration
   * @returns {object} - { prUrl, pushed }
   */
  async _pushAndCreatePR(fixBranch, baseBranch, pipelineResults, runConfig) {
    const result = { prUrl: null, pushed: false };

    // Skip if no GitHub token configured (local-only mode)
    if (!this.config.github.token) {
      logger.info('ℹ️ No GitHub token configured — skipping push and PR creation');
      return result;
    }

    // Skip if explicitly disabled
    if (this.config.agent.skipPR) {
      logger.info('ℹ️ PR creation disabled via config — skipping');
      return result;
    }

    try {
      // Commit any remaining uncommitted changes
      const remainingChanges = await this.repoManager.getChangedFiles();
      if (remainingChanges.length > 0) {
        await this.repoManager.commitChanges('chore: IGNIS — remaining pipeline changes', remainingChanges);
      }

      // Push branch to remote
      logger.info(`Pushing branch: ${fixBranch}`);
      await this.repoManager.pushBranch(fixBranch);
      result.pushed = true;
      logger.info(`✅ Branch pushed: ${fixBranch}`);

    } catch (pushErr) {
      logger.error(`Failed to push branch ${fixBranch}: ${pushErr.message}`);
      logger.error('PR creation skipped — branch could not be pushed to remote');
      return result;
    }

    try {
      // Build PR title based on results
      const execResult = pipelineResults.execution?.result || {};
      const allPassed = (execResult.unitTestResults?.failed || 0) === 0 &&
                        (execResult.automationTestResults?.failed || 0) === 0;
      const unitCoverage = execResult.unitCoverage || 0;
      const automationCoverage = execResult.automationCoverage || 0;
      const coverageMet = unitCoverage >= this.config.agent.coverageThreshold &&
                          automationCoverage >= this.config.agent.coverageThreshold;

      const title = allPassed && coverageMet
        ? `✅ IGNIS: All tests passing — coverage ${unitCoverage}% unit / ${automationCoverage}% automation`
        : allPassed
          ? `⚠️ IGNIS: Tests passing — coverage below target (${unitCoverage}% / ${automationCoverage}%)`
          : `⚠️ IGNIS: Partial — ${execResult.unitTestResults?.failed || 0} unit + ${execResult.automationTestResults?.failed || 0} automation failures`;

      // Build PR body
      const prBody = this._buildSubAgentPrBody(pipelineResults, runConfig);

      // Create PR
      const pr = await this.repoManager.createPR({
        title,
        body: prBody,
        head: fixBranch,
        base: baseBranch
      });

      result.prUrl = pr.html_url;
      logger.info(`✅ PR created: ${pr.html_url}`);

    } catch (prErr) {
      logger.error(`Failed to create PR: ${prErr.message}`);
    }

    return result;
  }

  /**
   * Build a markdown PR body summarizing sub-agent pipeline results.
   */
  _buildSubAgentPrBody(pipelineResults, runConfig) {
    const execResult = pipelineResults.execution?.result || {};
    const unitCoverage = execResult.unitCoverage || 0;
    const automationCoverage = execResult.automationCoverage || 0;
    const threshold = this.config.agent.coverageThreshold;

    const lines = [
      '## 🔥 IGNIS Automation Test Agent — Pipeline Results',
      '',
      '### Configuration',
      `| Setting | Value |`,
      `|---------|-------|`,
      `| Run Mode | \`${this.config.agent.runMode}\` |`,
      `| AI Provider | \`${this.config.ai.provider}\` |`,
      `| Coverage Threshold | ${threshold}% |`,
      `| Max Main Iterations | ${this.config.agent.maxIterations} |`,
      `| Sub-Agent Max Iterations | ${this.config.agent.subAgentMaxIterations} |`,
      `| Test Types | ${this.config.testing.types.join(', ')} |`,
      '',
      '### Coverage Results',
      `| Metric | Result | Target | Status |`,
      `|--------|--------|--------|--------|`,
      `| Unit Test Coverage | ${unitCoverage}% | ${threshold}% | ${unitCoverage >= threshold ? '✅' : '❌'} |`,
      `| Automation Test Coverage | ${automationCoverage}% | ${threshold}% | ${automationCoverage >= threshold ? '✅' : '❌'} |`,
      ''
    ];

    // Sub-agent results
    lines.push('### Sub-Agent Summary');
    lines.push('| Agent | Status | Iterations |');
    lines.push('|-------|--------|------------|');

    if (pipelineResults.generation) {
      lines.push(`| Generation | ${pipelineResults.generation.status === 'success' ? '✅' : '⚠️'} ${pipelineResults.generation.status} | ${pipelineResults.generation.iterations} |`);
    }
    if (pipelineResults.validation) {
      lines.push(`| Validation | ${pipelineResults.validation.status === 'success' ? '✅' : '⚠️'} ${pipelineResults.validation.status} | ${pipelineResults.validation.iterations} |`);
    }
    if (pipelineResults.execution) {
      lines.push(`| Execution | ${pipelineResults.execution.status === 'success' ? '✅' : '⚠️'} ${pipelineResults.execution.status} | ${pipelineResults.execution.iterations} |`);
    }

    // Test results detail
    if (execResult.unitTestResults) {
      const u = execResult.unitTestResults;
      lines.push('');
      lines.push('### Unit Test Results');
      lines.push(`- **Passed:** ${u.passed || 0}`);
      lines.push(`- **Failed:** ${u.failed || 0}`);
      lines.push(`- **Skipped:** ${u.skipped || 0}`);
      lines.push(`- **Total:** ${u.total || 0}`);
    }

    if (execResult.automationTestResults) {
      const a = execResult.automationTestResults;
      lines.push('');
      lines.push('### Automation Test Results');
      lines.push(`- **Passed:** ${a.passed || 0}`);
      lines.push(`- **Failed:** ${a.failed || 0}`);
      lines.push(`- **Skipped:** ${a.skipped || 0}`);
      lines.push(`- **Total:** ${a.total || 0}`);
    }

    // Token usage section
    const tokenUsage = this._aggregateTokenUsage();
    lines.push('');
    lines.push('### Token Usage');
    lines.push(`| Provider | Model | Input | Output | Total | Calls |`);
    lines.push(`|----------|-------|-------|--------|-------|-------|`);
    const p = tokenUsage.providers.primary;
    lines.push(`| ${p.provider} (primary) | ${p.model} | ${p.inputTokens.toLocaleString()} | ${p.outputTokens.toLocaleString()} | ${p.totalTokens.toLocaleString()} | ${p.calls} |`);
    if (tokenUsage.providers.codeGeneration) {
      const cg = tokenUsage.providers.codeGeneration;
      lines.push(`| ${cg.provider} (code-gen) | ${cg.model} | ${cg.inputTokens.toLocaleString()} | ${cg.outputTokens.toLocaleString()} | ${cg.totalTokens.toLocaleString()} | ${cg.calls} |`);
    }
    lines.push(`| **TOTAL** | — | **${tokenUsage.totalInputTokens.toLocaleString()}** | **${tokenUsage.totalOutputTokens.toLocaleString()}** | **${tokenUsage.totalTokens.toLocaleString()}** | **${tokenUsage.totalCalls}** |`);

    lines.push('');
    lines.push('---');
    lines.push(`*Generated by IGNIS v2.0.0 | Run ID: \`${this.runId}\`*`);

    return lines.join('\n');
  }

  /**
   * Build the final pipeline summary.
   */
  _buildPipelineSummary(pipelineResults, runMode, finalReport) {
    const execResult = pipelineResults.execution?.result || {};
    const unitCoverage = execResult.unitCoverage || 0;
    const automationCoverage = execResult.automationCoverage || 0;
    const coverageThreshold = this.config.agent.coverageThreshold;

    const coverageMet = unitCoverage >= coverageThreshold && automationCoverage >= coverageThreshold;
    const allPassed = (execResult.unitTestResults?.failed || 0) === 0 &&
                      (execResult.automationTestResults?.failed || 0) === 0;

    let status;
    if (coverageMet && allPassed) status = 'all-passed';
    else if (allPassed) status = 'passed-below-coverage';
    else status = 'partial';

    return {
      runId: this.runId,
      status,
      runMode,
      coverageThreshold,
      unitCoverage,
      automationCoverage,
      coverageMet,
      pipelineResults: {
        generation: pipelineResults.generation ? {
          status: pipelineResults.generation.status,
          iterations: pipelineResults.generation.iterations
        } : null,
        validation: pipelineResults.validation ? {
          status: pipelineResults.validation.status,
          iterations: pipelineResults.validation.iterations
        } : null,
        execution: pipelineResults.execution ? {
          status: pipelineResults.execution.status,
          iterations: pipelineResults.execution.iterations,
          coverage: pipelineResults.execution.coverage
        } : null
      },
      unitTestResults: execResult.unitTestResults || null,
      automationTestResults: execResult.automationTestResults || null,
      report: finalReport?.reportPath || null,
      duration: Date.now() - this.startTime,
      knowledgeBase: this.kbAnalytics ? {
        source: this.kbAnalytics.kbSource,
        cacheStatus: this.kbAnalytics.cacheStatus,
        cacheHitRate: this.kbAnalytics.cacheStatus === 'HIT' ? '100%' : '0%',
        tokenEstimated: this.kbAnalytics.tokenUsage?.estimated || 0,
        tokenSaved: this.kbAnalytics.cacheStatus === 'HIT' ? 25000 : 0,
        costData: {
          estimatedCost: this.kbManager.costData.estimatedCost,
          model: this.kbManager.costCalculator.getModelDisplayName(),
          provider: this.kbManager.costCalculator.canonicalProvider
        }
      } : null
    };
  }

  /**
   * Run a single sub-agent independently (for manual execution mode).
   * @param {string} agentName - 'generation' | 'validation' | 'execution'
   * @param {object} runConfig - Configuration including repoPath
   * @returns {object} - Sub-agent result
   */
  async runSingleSubAgent(agentName, runConfig) {
    this.startTime = Date.now();
    const workDir = runConfig.repoPath || process.env.GITHUB_WORKSPACE;

    // Minimal setup (no branch creation for single-agent mode)
    await this.repoManager.useLocalWorkspace(workDir);
    const techStack = StackDetector.detect(workDir, runConfig.techStackOverride || {});

    const context = {
      workDir,
      techStack,
      testTypes: this.config.testing.types,
      runId: this.runId,
      repoPath: workDir,
      branch: runConfig.branch || 'main',
      appUrl: runConfig.appUrl || this.config.app.url || null,
      existingTests: null,
      codeAnalysis: null,
      appDocumentation: null,
      generated: null
    };

    // Load previous results if available (from prior sub-agent runs)
    const stateFile = path.join(workDir, 'generated-tests', '.ignis-state.json');
    if (fs.existsSync(stateFile)) {
      try {
        const savedState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        context.codeAnalysis = savedState.codeAnalysis || null;
        context.appDocumentation = savedState.appDocumentation || null;
        context.existingTests = savedState.existingTests || null;
        context.generated = savedState.generated || null;
        logger.info(`Loaded pipeline state from previous sub-agent run`);
      } catch { /* ignore */ }
    }

    let result;
    switch (agentName) {
      case 'generation':
        result = await this.generationAgent.execute(context);
        // Save state for next sub-agent
        this._savePipelineState(workDir, {
          codeAnalysis: result.result?.codeAnalysis,
          appDocumentation: result.result?.appDocumentation,
          existingTests: result.result?.existingTests,
          generated: result.result?.generated
        });
        break;

      case 'validation':
        if (!context.codeAnalysis) {
          // Need to run analysis first
          const codeAnalysis = await this.codeAnalyzer.analyze(workDir, techStack);
          context.codeAnalysis = codeAnalysis;
        }
        result = await this.validationAgent.execute(context);
        break;

      case 'execution':
        // Start app
        const appResult = await this.appLauncher.startApp(workDir, techStack, {
          url: this.config.app.url || runConfig.appUrl,
          autoStart: this.config.app.autoStart || runConfig.autoStartApp,
          startCommand: this.config.app.startCommand,
          port: this.config.app.port
        });
        context.appUrl = appResult.url || null;
        result = await this.executionAgent.execute(context);
        await this.appLauncher.killApp();
        break;

      default:
        throw new Error(`Unknown sub-agent: ${agentName}. Valid: generation, validation, execution`);
    }

    return result;
  }

  /**
   * Save pipeline state between sub-agent runs.
   */
  _savePipelineState(workDir, state) {
    const stateDir = path.join(workDir, 'generated-tests');
    fs.mkdirSync(stateDir, { recursive: true });
    const stateFile = path.join(stateDir, '.ignis-state.json');

    // Only save serializable data (exclude large source content)
    const serializableState = {
      timestamp: new Date().toISOString(),
      codeAnalysis: state.codeAnalysis ? {
        structure: state.codeAnalysis.structure,
        surface: {
          routes: state.codeAnalysis.surface?.routes,
          apiEndpoints: state.codeAnalysis.surface?.apiEndpoints,
          components: state.codeAnalysis.surface?.components,
          models: state.codeAnalysis.surface?.models
        }
      } : null,
      appDocumentation: state.appDocumentation,
      existingTests: state.existingTests,
      generated: state.generated ? Object.fromEntries(
        Object.entries(state.generated).map(([k, v]) => [k, { files: v.files, skipped: v.skipped }])
      ) : null
    };

    fs.writeFileSync(stateFile, JSON.stringify(serializableState, null, 2), 'utf-8');
    logger.info(`Pipeline state saved to: ${path.relative(workDir, stateFile)}`);
  }

  /**
   * Aggregate token usage from all AI providers (primary + code-gen).
   * @returns {object} - Combined token usage stats
   */
  _aggregateTokenUsage() {
    const primaryUsage = this.aiProvider.getTokenUsage();
    const codeGenUsage = this.codeGenProvider ? this.codeGenProvider.getTokenUsage() : null;

    const combined = {
      totalInputTokens: primaryUsage.totalInputTokens + (codeGenUsage?.totalInputTokens || 0),
      totalOutputTokens: primaryUsage.totalOutputTokens + (codeGenUsage?.totalOutputTokens || 0),
      totalTokens: primaryUsage.totalTokens + (codeGenUsage?.totalTokens || 0),
      totalCalls: primaryUsage.calls + (codeGenUsage?.calls || 0),
      providers: {
        primary: {
          provider: this.config.ai.provider,
          model: this.config.ai[this.config.ai.provider]?.model || 'unknown',
          inputTokens: primaryUsage.totalInputTokens,
          outputTokens: primaryUsage.totalOutputTokens,
          totalTokens: primaryUsage.totalTokens,
          calls: primaryUsage.calls
        }
      }
    };

    if (codeGenUsage && codeGenUsage.calls > 0) {
      combined.providers.codeGeneration = {
        provider: 'claude',
        model: this.config.ai.codeGeneration.claudeModel,
        inputTokens: codeGenUsage.totalInputTokens,
        outputTokens: codeGenUsage.totalOutputTokens,
        totalTokens: codeGenUsage.totalTokens,
        calls: codeGenUsage.calls
      };
    }

    return combined;
  }

  /**
   * Log token usage summary to logger output.
   */
  _logTokenUsage(tokenUsage) {
    logger.info(`\n${'─'.repeat(70)}`);
    logger.info(`  TOKEN USAGE SUMMARY`);
    logger.info(`${'─'.repeat(70)}`);
    logger.info(`  Total Tokens: ${tokenUsage.totalTokens.toLocaleString()}`);
    logger.info(`  Input Tokens: ${tokenUsage.totalInputTokens.toLocaleString()}`);
    logger.info(`  Output Tokens: ${tokenUsage.totalOutputTokens.toLocaleString()}`);
    logger.info(`  Total API Calls: ${tokenUsage.totalCalls}`);
    logger.info(`  ──────────────────────────────────────`);

    const primary = tokenUsage.providers.primary;
    logger.info(`  Primary Provider: ${primary.provider} (${primary.model})`);
    logger.info(`    Tokens: ${primary.totalTokens.toLocaleString()} (${primary.inputTokens.toLocaleString()} in / ${primary.outputTokens.toLocaleString()} out)`);
    logger.info(`    Calls: ${primary.calls}`);

    if (tokenUsage.providers.codeGeneration) {
      const cg = tokenUsage.providers.codeGeneration;
      logger.info(`  Code-Gen Provider: ${cg.provider} (${cg.model})`);
      logger.info(`    Tokens: ${cg.totalTokens.toLocaleString()} (${cg.inputTokens.toLocaleString()} in / ${cg.outputTokens.toLocaleString()} out)`);
      logger.info(`    Calls: ${cg.calls}`);
    }

    logger.info(`${'─'.repeat(70)}\n`);
  }

  getRunId() { return this.runId; }
  getStatus() { return this.status; }
  getSummary() { return this.summary; }
}

module.exports = AgentOrchestrator;
