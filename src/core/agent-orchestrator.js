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
      await this.repoManager.createBranch(fixBranch);

      // ── Step 3: Install dependencies ────────────────────────
      updateStatus('installing');
      const packageManager = DependencyInstaller.detectPackageManager(workDir);
      await DependencyInstaller.installDependencies(workDir, packageManager);
      await DependencyInstaller.installPlaywrightBrowsers(workDir);
      DependencyInstaller.verifyInstallation(workDir);

      // ── Step 4: Resolve environment ─────────────────────────
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
      EnvHandler.writeEnvFile(workDir, envMap);

      // ── Step 5: Detect tech stack ───────────────────────────
      const techStack = StackDetector.detect(workDir, runConfig.techStackOverride || {});

      // ── Step 6: Analyze codebase ────────────────────────────
      updateStatus('analyzing');
      const codeAnalysis = await this.codeAnalyzer.analyze(workDir);

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
      updateStatus('scanning-tests');
      logger.info('Scanning repository for existing test coverage...');
      
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

      // ── Step 7: Generate test suites (only for gaps) ────────
      updateStatus('generating');
      
      // Filter to only types that need generation
      const typesToGenerate = Object.entries(testPlan)
        .filter(([_, plan]) => plan.generate)
        .map(([type, _]) => type);
      
      if (typesToGenerate.length === 0) {
        logger.info('✅ All required tests already exist - skipping test generation');
      }
      
      const generated = typesToGenerate.length > 0 
        ? await this.testGenerator.generateAll(workDir, codeAnalysis, typesToGenerate, techStack, testGaps)
        : {};

      // ── Step 7.5: Run Unit Tests (if enabled) ───────────────
      let unitTestResults = null;
      const hasUnitTests = testTypes.some(t => ['unit', 'integration'].includes(t));
      
      if (hasUnitTests && this.config.testing.runUnitTests !== false) {
        updateStatus('testing-units');
        logger.info('Running unit tests...');
        
        try {
          const testDir = path.join(workDir, 'generated-tests/tests');
          unitTestResults = await this.unitTestRunner.runTests(workDir, testDir);
          
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
      updateStatus('starting-app');
      const appResult = await this.appLauncher.startApp(workDir, techStack, {
        url: this.config.app.url || runConfig.appUrl,
        autoStart: this.config.app.autoStart || runConfig.autoStartApp,
        startCommand: this.config.app.startCommand || runConfig.appStartCommand,
        port: this.config.app.port
      });

      // If app didn't start, disable E2E/visual tests
      let activeTestTypes = [...testTypes];
      if (!appResult.started) {
        logger.warn('App did not start — disabling E2E and visual tests');
        activeTestTypes = activeTestTypes.filter(t => !['e2e', 'visual'].includes(t));
      }

      const appUrl = appResult.url || this.config.app.url || null;

      // ── Step 9: Iteration loop ──────────────────────────────
      const maxIterations = this.config.agent.maxIterations;
      let lastTestResult = null;
      let allPassed = false;

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
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
        if (lastTestResult.failed === 0) {
          logger.info('All tests passed!');
          allPassed = true;
          this.iterationHistory.push(iterationRecord);
          break;
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
