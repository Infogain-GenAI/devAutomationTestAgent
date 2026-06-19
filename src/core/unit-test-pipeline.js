'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const logger = require('../utils/logger');
const promptLoader = require('../utils/prompt-loader');
const TestConfigManager = require('./test-config-manager');

/**
 * Unit Test Pipeline — Dedicated orchestrator for unit test generation & execution.
 * 
 * Pipeline Stages:
 *   1. Generate API Documentation
 *   2. Verify/Validate the documentation
 *   3. Generate unit tests in chunks (targeting 90%+ coverage)
 *   4. Verify unit tests and fix issues
 *   5. Run unit tests with detailed logging and reporting
 * 
 * Uses separated prompt templates for granular prompt engineering:
 *   - config/prompts/system-generate-api-docs.md
 *   - config/prompts/system-verify-api-docs.md
 *   - config/prompts/system-generate-unit-tests.md
 *   - config/prompts/system-verify-unit-tests.md
 *   - config/prompts/system-fix-unit-tests.md
 *   - config/prompts/system-unit-test-report.md
 */
class UnitTestPipeline {
  constructor(config, dependencies) {
    this.config = config;
    this.aiProvider = dependencies.aiProvider;
    this.codeGenProvider = dependencies.codeGenProvider || dependencies.aiProvider;
    this.unitTestRunner = dependencies.unitTestRunner;
    this.promptLoader = promptLoader;
    
    // Initialize Test Configuration Manager
    this.testConfigManager = new TestConfigManager(config);

    // Configuration
    this.coverageTarget = config.coverageThreshold || 90;
    this.maxFixIterations = config.unitTestFixIterations || 3;
    this.maxChunks = config.maxUnitTestChunks || 10;
    this.testFramework = config.unitTestFramework || 'auto'; // auto, jest, playwright
  }

  /**
   * Execute the full unit test pipeline.
   * 
   * @param {object} context - Pipeline context
   * @param {string} context.workDir - Workspace directory
   * @param {object} context.techStack - Detected tech stack
   * @param {object} context.codeAnalysis - Code analysis results
   * @param {object} [context.existingTests] - Already-existing tests
   * @returns {object} Pipeline results with coverage, test results, and reports
   */
  async execute(context) {
    const { workDir, techStack, codeAnalysis } = context;
    const startTime = Date.now();

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('  UNIT TEST PIPELINE — Starting');
    logger.info('═══════════════════════════════════════════════════════════');

    // Detect test framework
    const framework = this._detectFramework(workDir, techStack);
    logger.info(`[unit-pipeline] Framework: ${framework}`);

    // ── Stage 0: Validate Test Configurations ────────────────────
    logger.info('[unit-pipeline] Stage 0: Validating Test Configurations');
    try {
      await this.testConfigManager.ensureConfigurations();
      
      // Validate Unit test configuration
      try {
        const unitConfig = await this.testConfigManager.validateTestConfig('unit');
        logger.info(`[unit-pipeline] ✅ Unit test configuration validated`);
      } catch (err) {
        logger.warn(`[unit-pipeline] Unit config validation warning: ${err.message}`);
      }
      
      // Print configuration summary
      this.testConfigManager.printConfigurationSummary();
    } catch (err) {
      logger.error(`[unit-pipeline] ❌ Configuration validation failed: ${err.message}`);
      throw err;
    }

    // ── Stage 1: Verify Dependencies ─────────────────────────────
    logger.info('[unit-pipeline] Stage 1: Dependency Verification');
    await this._verifyDependencies(workDir, framework);

    // ── Stage 2: Generate API Documentation ──────────────────────
    logger.info('[unit-pipeline] Stage 2: API Documentation Generation');
    let apiDocumentation;
    try {
      apiDocumentation = await this._generateApiDocumentation(workDir, techStack, codeAnalysis);
      logger.info(`[unit-pipeline] ✅ API docs generated — ${apiDocumentation.apiEndpoints?.length || 0} endpoints, ${apiDocumentation.dataModels?.length || 0} models`);
    } catch (err) {
      logger.warn(`[unit-pipeline] API doc generation failed (non-fatal): ${err.message}`);
      apiDocumentation = { apiEndpoints: [], dataModels: [], businessLogic: [] };
    }

    // ── Stage 3: Verify Documentation ────────────────────────────
    logger.info('[unit-pipeline] Stage 3: Documentation Verification');
    try {
      apiDocumentation = await this._verifyApiDocumentation(workDir, apiDocumentation, codeAnalysis);
      logger.info('[unit-pipeline] ✅ Documentation verified and corrected');
    } catch (err) {
      logger.warn(`[unit-pipeline] Doc verification failed (non-fatal): ${err.message}`);
    }

    // ── Stage 4: Generate Unit Tests in Chunks ───────────────────
    logger.info('[unit-pipeline] Stage 4: Unit Test Generation (chunked)');
    const generatedFiles = await this._generateUnitTestsChunked(workDir, techStack, codeAnalysis, apiDocumentation, framework);
    logger.info(`[unit-pipeline] ✅ Generated ${generatedFiles.length} test file(s)`);

    // ── Stage 5: Verify & Fix Unit Tests ─────────────────────────
    logger.info('[unit-pipeline] Stage 5: Test Verification & Fixing');
    const verifiedFiles = await this._verifyAndFixTests(workDir, generatedFiles, techStack, framework);
    logger.info(`[unit-pipeline] ✅ ${verifiedFiles.ready} files ready, ${verifiedFiles.fixed} fixed, ${verifiedFiles.skipped} skipped`);

    // ── Stage 5: Execute Unit Tests ──────────────────────────────
    logger.info('[unit-pipeline] Stage 5: Test Execution');
    const executionResult = await this._executeTests(workDir, techStack, framework);

    // ── Stage 6: Fix Failures & Re-run (iterative) ───────────────
    let finalResult = executionResult;
    if (executionResult.failed > 0 && this.maxFixIterations > 0) {
      logger.info(`[unit-pipeline] Stage 6: Fixing ${executionResult.failed} failure(s)...`);
      finalResult = await this._fixAndRerun(workDir, executionResult, techStack, framework);
    }

    // ── Stage 7: Generate Report ─────────────────────────────────
    logger.info('[unit-pipeline] Stage 7: Report Generation');
    const report = await this._generateReport(finalResult, workDir);

    const duration = Date.now() - startTime;
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`  UNIT TEST PIPELINE — Complete (${(duration / 1000).toFixed(1)}s)`);
    logger.info(`  Coverage: ${finalResult.coverage || 0}% | Pass Rate: ${finalResult.total ? Math.round(finalResult.passed / finalResult.total * 100) : 0}%`);
    logger.info('═══════════════════════════════════════════════════════════');

    return {
      ...finalResult,
      apiDocumentation,
      generatedFiles: generatedFiles.length,
      report,
      duration
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 0: DEPENDENCY VERIFICATION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Verify all required packages are installed for the test framework.
   * Installs missing ones. Ensures headless mode support.
   */
  async _verifyDependencies(workDir, framework) {
    const requiredPackages = {
      jest: [
        'jest', 'jest-environment-jsdom', '@swc/jest', '@swc/core',
        '@testing-library/jest-dom'
      ],
      playwright: [
        '@playwright/test'
      ]
    };

    const frameworkDeps = requiredPackages[framework] || requiredPackages.jest;
    const missing = [];

    for (const pkg of frameworkDeps) {
      if (!this._isPackageAvailable(pkg, workDir)) {
        missing.push(pkg);
      }
    }

    if (missing.length > 0) {
      logger.info(`[unit-pipeline] Installing missing test dependencies: ${missing.join(', ')}`);
      try {
        execSync(`npm install --save-dev ${missing.join(' ')}`, {
          cwd: workDir,
          stdio: 'pipe',
          timeout: 120000,
          env: { ...process.env, NODE_ENV: 'development' }
        });
        logger.info(`[unit-pipeline] ✅ Installed: ${missing.join(', ')}`);
      } catch (err) {
        logger.warn(`[unit-pipeline] Some deps failed to install locally: ${err.message.slice(0, 100)}`);
        // Try globally as fallback (Docker container)
        try {
          execSync(`npm install -g ${missing.join(' ')}`, { stdio: 'pipe', timeout: 120000 });
          logger.info('[unit-pipeline] ✅ Installed globally as fallback');
        } catch {
          logger.warn('[unit-pipeline] Could not install all deps — tests may fail for missing modules');
        }
      }
    }

    // Verify Playwright browsers if using Playwright for unit tests
    if (framework === 'playwright') {
      try {
        execSync('npx playwright install chromium --with-deps', {
          cwd: workDir, stdio: 'pipe', timeout: 180000
        });
        logger.info('[unit-pipeline] ✅ Playwright browsers verified');
      } catch (err) {
        logger.warn(`[unit-pipeline] Playwright browser install issue: ${err.message.slice(0, 100)}`);
      }
    }

    // Verify headless mode env vars are set
    if (!process.env.CI) process.env.CI = 'true';
    if (!process.env.HEADLESS) process.env.HEADLESS = 'true';
    if (!process.env.PLAYWRIGHT_HEADLESS) process.env.PLAYWRIGHT_HEADLESS = '1';

    logger.info('[unit-pipeline] ✅ Dependencies verified for headless mode');
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 1: API DOCUMENTATION GENERATION
  // ═══════════════════════════════════════════════════════════════

  async _generateApiDocumentation(workDir, techStack, codeAnalysis) {
    // Gather source files for API routes, models, services
    const sourceContext = this._gatherSourceForDocs(workDir, codeAnalysis);

    const systemPrompt = this.promptLoader.load('system-generate-api-docs', {
      language: techStack.language || 'TypeScript',
      framework: techStack.framework || 'Next.js',
      moduleSystem: techStack.moduleSystem || 'ESM'
    });

    const userMessage = `Generate comprehensive API documentation for this codebase.

## File Structure:
${codeAnalysis.structure?.stats ? `Total files: ${codeAnalysis.structure.stats.totalFiles}` : ''}

## Key Source Files:
${Object.entries(sourceContext).map(([name, content]) => 
  `### ${name}\n\`\`\`\n${content.slice(0, 8000)}\n\`\`\``
).join('\n\n')}

## Detected Routes/Endpoints from Analysis:
${JSON.stringify(codeAnalysis.surface?.apiEndpoints || codeAnalysis.surface?.routes || [], null, 2).slice(0, 5000)}

## Data Models:
${JSON.stringify(codeAnalysis.surface?.models || [], null, 2).slice(0, 3000)}
`;

    const response = await this.codeGenProvider.analyzeCode({
      phase: 'api-documentation',
      systemPrompt,
      context: userMessage
    });

    // Parse the response
    return this._parseJsonResponse(response, { apiEndpoints: [], dataModels: [], businessLogic: [] });
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 2: DOCUMENTATION VERIFICATION
  // ═══════════════════════════════════════════════════════════════

  async _verifyApiDocumentation(workDir, documentation, codeAnalysis) {
    // Get actual route files to verify against
    const routeFiles = this._findRouteFiles(workDir);
    const sourceFiles = routeFiles.slice(0, 10).map(f => ({
      path: path.relative(workDir, f),
      language: f.endsWith('.ts') || f.endsWith('.tsx') ? 'typescript' : 'javascript',
      content: fs.readFileSync(f, 'utf-8').slice(0, 5000)
    }));

    const systemPrompt = this.promptLoader.load('system-verify-api-docs', {
      language: 'TypeScript',
      framework: 'Next.js'
    });

    const userMessage = JSON.stringify({
      documentation: JSON.stringify(documentation).slice(0, 15000),
      sourceFiles
    });

    const response = await this.aiProvider.analyzeCode({
      phase: 'verify-documentation',
      systemPrompt,
      context: userMessage
    });

    const verification = this._parseJsonResponse(response, { status: 'accurate' });

    // Apply corrections if needed
    if (verification.missingEndpoints?.length > 0) {
      logger.info(`[unit-pipeline] Found ${verification.missingEndpoints.length} missing endpoint(s) — adding to docs`);
      documentation.apiEndpoints = [
        ...(documentation.apiEndpoints || []),
        ...verification.missingEndpoints.map(ep => ({
          method: ep.method,
          path: ep.path,
          description: `Discovered from ${ep.sourceFile}`,
          requestBody: {},
          responseSchema: {}
        }))
      ];
    }

    if (verification.corrections?.apiEndpoints) {
      for (const correction of verification.corrections.apiEndpoints) {
        const endpoint = documentation.apiEndpoints?.find(
          e => e.path === correction.path && e.method === correction.method
        );
        if (endpoint && correction.field && correction.corrected) {
          endpoint[correction.field] = correction.corrected;
        }
      }
    }

    return documentation;
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 3: CHUNKED UNIT TEST GENERATION
  // ═══════════════════════════════════════════════════════════════

  async _generateUnitTestsChunked(workDir, techStack, codeAnalysis, apiDocumentation, framework) {
    // Identify source files that need unit tests
    const testableFiles = this._identifyTestableFiles(workDir, codeAnalysis);
    logger.info(`[unit-pipeline] Found ${testableFiles.length} testable source file(s)`);

    if (testableFiles.length === 0) {
      logger.warn('[unit-pipeline] No testable files found');
      return [];
    }

    // Split into chunks (max 5 files per chunk for quality)
    const CHUNK_SIZE = 5;
    const chunks = [];
    for (let i = 0; i < testableFiles.length; i += CHUNK_SIZE) {
      chunks.push(testableFiles.slice(i, i + CHUNK_SIZE));
    }

    const totalChunks = Math.min(chunks.length, this.maxChunks);
    logger.info(`[unit-pipeline] Split into ${totalChunks} chunk(s) (${CHUNK_SIZE} files/chunk)`);

    const allGeneratedFiles = [];
    const outputDir = path.join(workDir, 'generated-tests', 'tests', 'unit');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    for (let i = 0; i < totalChunks; i++) {
      const chunk = chunks[i];
      logger.info(`[unit-pipeline] Generating chunk ${i + 1}/${totalChunks} (${chunk.length} files)...`);

      try {
        const files = await this._generateChunk(
          workDir, chunk, techStack, apiDocumentation, framework, i + 1, totalChunks
        );

        // Write generated files
        for (const file of files) {
          const filePath = path.join(outputDir, path.basename(file.path));
          fs.writeFileSync(filePath, file.content, 'utf-8');
          allGeneratedFiles.push({ ...file, writtenPath: filePath });
        }

        logger.info(`[unit-pipeline] ✅ Chunk ${i + 1}: ${files.length} file(s) generated`);
      } catch (err) {
        logger.warn(`[unit-pipeline] Chunk ${i + 1} failed: ${err.message.slice(0, 200)}`);
      }
    }

    return allGeneratedFiles;
  }

  async _generateChunk(workDir, files, techStack, apiDocumentation, framework, chunkIndex, totalChunks) {
    // Read source file contents for context
    const targetFiles = files.map(f => {
      const content = fs.readFileSync(f.fullPath, 'utf-8');
      return {
        path: f.relativePath,
        description: this._describeFile(f.relativePath, content),
        content: content.slice(0, 6000)
      };
    });

    // Build mocking guidance based on the source code
    const mockingGuidance = this._buildMockingGuidance(targetFiles, techStack);

    const isJest = framework === 'jest';
    const fileExtension = techStack.language === 'TypeScript' ? 'test.ts' : 'test.js';

    const systemPrompt = this.promptLoader.load('system-generate-unit-tests', {
      language: techStack.language || 'TypeScript',
      framework: techStack.framework || 'Next.js',
      testRunner: isJest ? 'Jest' : 'Playwright',
      moduleSystem: techStack.moduleSystem || 'CommonJS',
      fileExtension,
      isJest,
      isPlaywright: !isJest,
      chunkIndex,
      totalChunks,
      targetFiles,
      apiDocumentation: JSON.stringify(apiDocumentation).slice(0, 8000),
      mockingGuidance
    });

    const userMessage = `Generate comprehensive unit tests for the following ${files.length} source file(s).
Target: 90%+ code coverage per file.

## Source Files to Test:
${targetFiles.map(f => `### \`${f.path}\`\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}

## API Documentation Context (for understanding expected behavior):
${JSON.stringify(apiDocumentation?.apiEndpoints?.slice(0, 10) || [], null, 2).slice(0, 4000)}

## Business Logic Context:
${JSON.stringify(apiDocumentation?.businessLogic?.slice(0, 5) || [], null, 2).slice(0, 2000)}
`;

    const response = await this.codeGenProvider.generateTests(
      { context: userMessage, systemPrompt, targetFiles },
      'unit',
      techStack
    );

    // Parse response
    const parsed = this._parseTestGenerationResponse(response);
    return parsed.files || [];
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 4: TEST VERIFICATION & FIXING
  // ═══════════════════════════════════════════════════════════════

  async _verifyAndFixTests(workDir, generatedFiles, techStack, framework) {
    if (generatedFiles.length === 0) return { ready: 0, fixed: 0, skipped: 0 };

    let ready = 0;
    let fixed = 0;
    let skipped = 0;

    // Process in batches of 5 for AI verification
    const BATCH_SIZE = 5;
    for (let i = 0; i < generatedFiles.length; i += BATCH_SIZE) {
      const batch = generatedFiles.slice(i, i + BATCH_SIZE);

      // First: syntax check each file
      for (const file of batch) {
        const filePath = file.writtenPath;
        if (!fs.existsSync(filePath)) { skipped++; continue; }

        const syntaxOk = this._checkSyntax(filePath);
        if (syntaxOk) {
          ready++;
        } else {
          // Try AI-based fix
          const wasFixed = await this._fixTestFile(filePath, workDir, techStack, framework);
          if (wasFixed) { fixed++; ready++; }
          else { skipped++; }
        }
      }

      // AI verification of the batch (check logic correctness)
      try {
        const fixes = await this._aiVerifyBatch(batch, workDir, techStack, framework);
        if (fixes && fixes.length > 0) {
          for (const fix of fixes) {
            const targetFile = batch.find(f => 
              f.writtenPath && path.basename(f.writtenPath) === path.basename(fix.file)
            );
            if (targetFile && fix.originalCode && fix.fixedCode) {
              const content = fs.readFileSync(targetFile.writtenPath, 'utf-8');
              if (content.includes(fix.originalCode)) {
                fs.writeFileSync(targetFile.writtenPath, content.replace(fix.originalCode, fix.fixedCode), 'utf-8');
                fixed++;
                logger.info(`[unit-pipeline] Applied verification fix: ${path.basename(targetFile.writtenPath)}`);
              }
            }
          }
        }
      } catch (err) {
        logger.debug(`[unit-pipeline] AI verification failed for batch: ${err.message.slice(0, 100)}`);
      }
    }

    return { ready, fixed, skipped };
  }

  async _aiVerifyBatch(batch, workDir, techStack, framework) {
    const testFiles = [];
    const sourceFiles = [];

    for (const file of batch) {
      if (!file.writtenPath || !fs.existsSync(file.writtenPath)) continue;
      testFiles.push({
        path: path.relative(workDir, file.writtenPath),
        language: file.writtenPath.endsWith('.ts') ? 'typescript' : 'javascript',
        content: fs.readFileSync(file.writtenPath, 'utf-8').slice(0, 5000)
      });

      // Find corresponding source file
      if (file.targetFile) {
        const srcPath = path.join(workDir, file.targetFile);
        if (fs.existsSync(srcPath)) {
          sourceFiles.push({
            path: file.targetFile,
            language: srcPath.endsWith('.ts') ? 'typescript' : 'javascript',
            content: fs.readFileSync(srcPath, 'utf-8').slice(0, 5000)
          });
        }
      }
    }

    if (testFiles.length === 0) return [];

    const systemPrompt = this.promptLoader.load('system-verify-unit-tests', {
      language: techStack.language || 'TypeScript',
      framework: techStack.framework || 'Next.js',
      testRunner: framework === 'jest' ? 'Jest' : 'Playwright'
    });

    const userMessage = JSON.stringify({ testFiles, sourceFiles });

    const response = await this.aiProvider.analyzeCode({
      phase: 'verify-unit-tests',
      systemPrompt,
      context: userMessage
    });

    const parsed = this._parseJsonResponse(response, { verificationResults: [] });

    // Extract fixes from verification results
    const fixes = [];
    for (const result of (parsed.verificationResults || [])) {
      if (result.issues) {
        for (const issue of result.issues) {
          if (issue.fix && issue.fix.originalCode && issue.fix.fixedCode) {
            fixes.push({
              file: result.file,
              originalCode: issue.fix.originalCode,
              fixedCode: issue.fix.fixedCode
            });
          }
        }
      }
    }

    return fixes;
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 5: TEST EXECUTION
  // ═══════════════════════════════════════════════════════════════

  async _executeTests(workDir, techStack, framework) {
    const testDir = path.join(workDir, 'generated-tests', 'tests', 'unit');
    if (!fs.existsSync(testDir)) {
      logger.warn('[unit-pipeline] No unit test directory found');
      return { passed: 0, failed: 0, total: 0, coverage: 0, exitCode: 1 };
    }

    // Also include repo's own test directories
    const testDirs = [testDir];
    const repoTestDirs = this._findRepoTestDirs(workDir);
    testDirs.push(...repoTestDirs);

    logger.info(`[unit-pipeline] Running tests from ${testDirs.length} directory(ies)...`);

    try {
      // Validate runner is available and has runTests method
      if (!this.unitTestRunner || typeof this.unitTestRunner.runTests !== 'function') {
        throw new Error('UnitTestRunner.runTests is not available - ensure unitTestRunner is initialized');
      }

      // Signature: runTests(workDir, testDirs, options)
      const results = await this.unitTestRunner.runTests(workDir, testDirs, {
        detectedFrameworks: [framework]
      });
      return results;
    } catch (err) {
      logger.error(`[unit-pipeline] Test execution error: ${err.message}`);
      return { passed: 0, failed: 0, total: 0, coverage: 0, exitCode: 1, errors: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 6: FIX FAILURES & RE-RUN
  // ═══════════════════════════════════════════════════════════════

  async _fixAndRerun(workDir, executionResult, techStack, framework) {
    let result = executionResult;

    for (let iteration = 0; iteration < this.maxFixIterations; iteration++) {
      if (result.failed === 0) break;

      logger.info(`[unit-pipeline] Fix iteration ${iteration + 1}/${this.maxFixIterations} — ${result.failed} failure(s)`);

      // Gather failed test info
      const failedFiles = this._extractFailedFiles(result, workDir);
      if (failedFiles.length === 0) break;

      // Use AI to generate fixes
      const fixes = await this._generateFixes(failedFiles, workDir, techStack, framework, result);

      if (!fixes || fixes.length === 0) {
        logger.info('[unit-pipeline] No fixes generated — stopping');
        break;
      }

      // Apply fixes
      let appliedCount = 0;
      for (const fix of fixes) {
        if (this._applyFix(fix, workDir)) appliedCount++;
      }

      if (appliedCount === 0) {
        logger.info('[unit-pipeline] No fixes could be applied — stopping');
        break;
      }

      logger.info(`[unit-pipeline] Applied ${appliedCount} fix(es). Re-running tests...`);

      // Re-run
      result = await this._executeTests(workDir, techStack, framework);

      if (result.failed === 0) {
        logger.info('[unit-pipeline] ✅ All tests passing after fixes!');
        break;
      }
    }

    return result;
  }

  async _generateFixes(failedFiles, workDir, techStack, framework, executionResult) {
    // Read source files for context
    const sourceFiles = [];
    for (const failed of failedFiles.slice(0, 5)) {
      if (failed.targetSource) {
        const srcPath = path.join(workDir, failed.targetSource);
        if (fs.existsSync(srcPath)) {
          sourceFiles.push({
            path: failed.targetSource,
            language: srcPath.endsWith('.ts') ? 'typescript' : 'javascript',
            content: fs.readFileSync(srcPath, 'utf-8').slice(0, 5000)
          });
        }
      }
    }

    const systemPrompt = this.promptLoader.load('system-fix-unit-tests', {
      language: techStack.language || 'TypeScript',
      framework: techStack.framework || 'Next.js',
      testRunner: framework === 'jest' ? 'Jest' : 'Playwright'
    });

    const userMessage = JSON.stringify({
      testOutput: (executionResult.rawOutput || executionResult.errors || '').slice(0, 10000),
      failedFiles: failedFiles.slice(0, 8),
      sourceFiles
    });

    const response = await this.codeGenProvider.generateFix(
      { systemPrompt, context: userMessage, failures: failedFiles },
      {}
    );

    const parsed = this._parseJsonResponse(response, { fixes: [] });
    return parsed.fixes || (Array.isArray(parsed) ? parsed : []);
  }

  _applyFix(fix, workDir) {
    if (!fix.file || !fix.originalCode || !fix.fixedCode) return false;

    // Resolve file path
    const candidates = [
      path.join(workDir, fix.file),
      path.join(workDir, 'generated-tests', fix.file),
      path.join(workDir, 'generated-tests', 'tests', 'unit', path.basename(fix.file))
    ];

    for (const filePath of candidates) {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      if (!content.includes(fix.originalCode)) continue;

      const newContent = content.replace(fix.originalCode, fix.fixedCode);
      
      // Validate the fix doesn't break syntax
      if (this._checkSyntaxContent(newContent, filePath)) {
        fs.writeFileSync(filePath, newContent, 'utf-8');
        return true;
      }
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // STAGE 7: REPORT GENERATION
  // ═══════════════════════════════════════════════════════════════

  async _generateReport(results, workDir) {
    const logDir = path.join(workDir, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(logDir, `unit-test-report-${timestamp}.json`);
    const logPath = path.join(logDir, `unit-test-results-${timestamp}.log`);

    const report = {
      timestamp: new Date().toISOString(),
      framework: results.framework || 'jest',
      coverage: results.coverage || 0,
      total: results.total || 0,
      passed: results.passed || 0,
      failed: results.failed || 0,
      skipped: results.skipped || 0,
      exitCode: results.exitCode,
      passRate: results.total ? `${Math.round(results.passed / results.total * 100)}%` : '0%',
      errors: results.errors?.slice(0, 5000) || '',
      skippedReason: results.skippedReason || ''
    };

    // Write JSON report
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    // Write human-readable log
    const logContent = [
      '═══════════════════════════════════════════════════════════',
      '  UNIT TEST EXECUTION REPORT',
      '═══════════════════════════════════════════════════════════',
      '',
      `Timestamp:  ${report.timestamp}`,
      `Framework:  ${report.framework}`,
      `Coverage:   ${report.coverage}%`,
      `Pass Rate:  ${report.passRate}`,
      '',
      `Total:      ${report.total}`,
      `Passed:     ${report.passed}`,
      `Failed:     ${report.failed}`,
      `Skipped:    ${report.skipped}`,
      `Exit Code:  ${report.exitCode}`,
      report.skippedReason ? `Skip Reason:${report.skippedReason}` : '',
      '',
      '───────────────────────────────────────────────────────────',
      'ERRORS:',
      report.errors || 'None',
      '═══════════════════════════════════════════════════════════'
    ].join('\n');

    fs.writeFileSync(logPath, logContent, 'utf-8');
    logger.info(`[unit-pipeline] Report written: ${path.basename(reportPath)}`);
    logger.info(`[unit-pipeline] Log written: ${path.basename(logPath)}`);

    return { reportPath, logPath, ...report };
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ═══════════════════════════════════════════════════════════════

  _detectFramework(workDir, techStack) {
    // Priority: env config > package.json scripts > auto-detect
    const configFramework = this.config.unitTestFramework || process.env.UNIT_TEST_FRAMEWORK;
    if (configFramework && configFramework !== 'auto') return configFramework;

    // Check package.json for test script hints
    const pkgPaths = [
      path.join(workDir, 'package.json'),
      path.join(workDir, 'src', 'package.json')
    ];

    for (const pkgPath of pkgPaths) {
      if (!fs.existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const testScript = pkg.scripts?.test || '';
        if (testScript.includes('jest') || pkg.devDependencies?.jest || pkg.dependencies?.jest) {
          return 'jest';
        }
        if (testScript.includes('playwright') || pkg.devDependencies?.['@playwright/test']) {
          return 'playwright';
        }
      } catch {}
    }

    return 'jest'; // Default
  }

  _isPackageAvailable(pkg, cwd) {
    try {
      require.resolve(pkg, { paths: [cwd, path.join(cwd, 'node_modules')] });
      return true;
    } catch {
      try { require.resolve(pkg); return true; } catch { return false; }
    }
  }

  _gatherSourceForDocs(workDir, codeAnalysis) {
    const sources = {};
    const routeFiles = this._findRouteFiles(workDir);
    const modelFiles = this._findModelFiles(workDir);
    const serviceFiles = this._findServiceFiles(workDir);

    // Prioritize: routes > models > services (cap total at 15 files)
    const allFiles = [...routeFiles.slice(0, 8), ...modelFiles.slice(0, 4), ...serviceFiles.slice(0, 3)];

    for (const file of allFiles) {
      const key = path.relative(workDir, file);
      try {
        sources[key] = fs.readFileSync(file, 'utf-8');
      } catch {}
    }

    return sources;
  }

  _findRouteFiles(workDir) {
    const patterns = [
      path.join(workDir, 'src', 'app', 'api', '**', 'route.{ts,js}'),
      path.join(workDir, 'src', 'pages', 'api', '**', '*.{ts,js}'),
      path.join(workDir, 'src', 'routes', '**', '*.{ts,js}'),
      path.join(workDir, 'app', 'api', '**', 'route.{ts,js}')
    ];
    return this._globFiles(workDir, ['**/api/**/route.ts', '**/api/**/route.js', '**/pages/api/**/*.ts', '**/routes/**/*.ts']);
  }

  _findModelFiles(workDir) {
    return this._globFiles(workDir, ['**/models/**/*.ts', '**/prisma/schema.prisma', '**/lib/prisma*.ts', '**/db/**/*.ts']);
  }

  _findServiceFiles(workDir) {
    return this._globFiles(workDir, ['**/services/**/*.ts', '**/lib/**/*.ts', '**/utils/**/*.ts']);
  }

  _globFiles(workDir, patterns) {
    const results = [];
    const walkDir = (dir, depth = 0) => {
      if (depth > 6) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const rel = path.relative(workDir, fullPath).replace(/\\/g, '/');
            for (const pattern of patterns) {
              if (this._matchGlob(rel, pattern)) {
                results.push(fullPath);
                break;
              }
            }
          }
        }
      } catch {}
    };
    walkDir(workDir);
    return results;
  }

  _matchGlob(filePath, pattern) {
    // Simple glob matching: ** matches anything, * matches non-slash
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '§§')
      .replace(/\*/g, '[^/]*')
      .replace(/§§/g, '.*')
      .replace(/\{([^}]+)\}/g, (_, options) => `(${options.split(',').join('|')})`);
    return new RegExp(`^${regex}$`).test(filePath);
  }

  _identifyTestableFiles(workDir, codeAnalysis) {
    const testable = [];
    const walkDir = (dir, depth = 0) => {
      if (depth > 5) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git' || 
              entry.name === 'generated-tests' || entry.name === '__tests__' || entry.name === 'test' ||
              entry.name === 'tests' || entry.name === '__mocks__') continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) continue;
            if (entry.name.includes('.test.') || entry.name.includes('.spec.') || entry.name.includes('.d.ts')) continue;
            if (entry.name === 'jest.config.js' || entry.name === 'next.config.js' || entry.name === 'tailwind.config.js') continue;

            // Only include files with logic (not just type definitions, configs, etc.)
            try {
              const content = fs.readFileSync(fullPath, 'utf-8');
              if (content.length < 50) return; // Skip tiny files
              // Must have functions, classes, or exports
              if (/(?:export|function|class|const\s+\w+\s*=\s*(?:async\s*)?\(|module\.exports)/.test(content)) {
                testable.push({
                  fullPath,
                  relativePath: path.relative(workDir, fullPath).replace(/\\/g, '/'),
                  size: content.length
                });
              }
            } catch {}
          }
        }
      } catch {}
    };

    // Scan src/ first (where most logic lives)
    const srcDir = path.join(workDir, 'src');
    if (fs.existsSync(srcDir)) walkDir(srcDir);
    
    // Also scan lib/, app/ if they exist at root
    const libDir = path.join(workDir, 'lib');
    if (fs.existsSync(libDir)) walkDir(libDir);

    // Sort by size descending (larger files need more tests)
    testable.sort((a, b) => b.size - a.size);

    return testable;
  }

  _describeFile(relativePath, content) {
    if (relativePath.includes('/api/') || relativePath.includes('route.')) return 'API route handler';
    if (relativePath.includes('/models/') || relativePath.includes('prisma')) return 'Data model';
    if (relativePath.includes('/services/') || relativePath.includes('/lib/')) return 'Business logic/service';
    if (relativePath.includes('/utils/') || relativePath.includes('/helpers/')) return 'Utility functions';
    if (relativePath.includes('/components/')) return 'UI component';
    if (relativePath.includes('/hooks/')) return 'Custom React hook';
    if (relativePath.includes('/middleware')) return 'Middleware';
    return 'Source file';
  }

  _buildMockingGuidance(targetFiles, techStack) {
    const guidance = [];
    const contentJoined = targetFiles.map(f => f.content).join('\n');

    if (contentJoined.includes('prisma') || contentJoined.includes('PrismaClient')) {
      guidance.push('- Mock Prisma: `jest.mock("@prisma/client")` or mock the prisma instance');
      guidance.push('  Use: `const { PrismaClient } = require("@prisma/client"); jest.mock("@prisma/client")`');
    }
    if (contentJoined.includes('fetch') || contentJoined.includes('axios')) {
      guidance.push('- Mock HTTP: `jest.mock("node-fetch")` or `jest.mock("axios")`');
    }
    if (contentJoined.includes('NextRequest') || contentJoined.includes('NextResponse')) {
      guidance.push('- Mock Next.js: Create mock NextRequest/NextResponse objects');
      guidance.push('  `const req = { json: jest.fn(), headers: new Map() }`');
    }
    if (contentJoined.includes('getServerSession') || contentJoined.includes('auth')) {
      guidance.push('- Mock auth: `jest.mock("next-auth")` with mock session');
    }
    if (contentJoined.includes('fs') || contentJoined.includes('readFile')) {
      guidance.push('- Mock fs: `jest.mock("fs")` with mock file contents');
    }

    return guidance.length > 0 ? guidance.join('\n') : null;
  }

  _checkSyntax(filePath) {
    try {
      if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
        // For TypeScript, basic syntax heuristic (no unexpected top-level errors)
        const content = fs.readFileSync(filePath, 'utf-8');
        // Check for obviously broken syntax
        if ((content.match(/\{/g) || []).length !== (content.match(/\}/g) || []).length) return false;
        if ((content.match(/\(/g) || []).length !== (content.match(/\)/g) || []).length) return false;
        return true;
      }
      // For JS files — use node --check
      execSync(`node --check "${filePath}"`, { stdio: 'pipe', timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  _checkSyntaxContent(content, filePath) {
    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      if ((content.match(/\{/g) || []).length !== (content.match(/\}/g) || []).length) return false;
      if ((content.match(/\(/g) || []).length !== (content.match(/\)/g) || []).length) return false;
      return true;
    }
    // For JS — write temp file and check
    const tmpPath = filePath + '.tmp.js';
    try {
      fs.writeFileSync(tmpPath, content, 'utf-8');
      execSync(`node --check "${tmpPath}"`, { stdio: 'pipe', timeout: 10000 });
      return true;
    } catch {
      return false;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  async _fixTestFile(filePath, workDir, techStack, framework) {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Simple fixes first: balance brackets
    let fixed = content;
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      fixed += '\n' + '}'.repeat(openBraces - closeBraces);
    }
    const openParens = (fixed.match(/\(/g) || []).length;
    const closeParens = (fixed.match(/\)/g) || []).length;
    if (openParens > closeParens) {
      fixed += ')'.repeat(openParens - closeParens) + ';';
    }

    if (fixed !== content) {
      fs.writeFileSync(filePath, fixed, 'utf-8');
      if (this._checkSyntax(filePath)) return true;
    }

    // Revert if basic fix didn't help
    fs.writeFileSync(filePath, content, 'utf-8');
    return false;
  }

  _extractFailedFiles(result, workDir) {
    const failures = result.failures || [];
    const failedFiles = [];

    for (const failure of failures.slice(0, 10)) {
      const file = failure.file || failure.testFilePath;
      if (!file) continue;

      const fullPath = path.isAbsolute(file) ? file : path.join(workDir, file);
      if (!fs.existsSync(fullPath)) continue;

      failedFiles.push({
        path: path.relative(workDir, fullPath),
        error: failure.message || failure.error || 'Unknown error',
        language: fullPath.endsWith('.ts') ? 'typescript' : 'javascript',
        content: fs.readFileSync(fullPath, 'utf-8').slice(0, 4000),
        targetSource: this._inferSourceFromTest(path.relative(workDir, fullPath))
      });
    }

    // If no structured failures, parse from stderr
    if (failedFiles.length === 0 && result.errors) {
      const failPattern = /FAIL\s+(.+\.(?:test|spec)\.[jt]sx?)/g;
      let match;
      while ((match = failPattern.exec(result.errors)) !== null) {
        const file = match[1];
        const fullPath = path.join(workDir, file);
        if (fs.existsSync(fullPath)) {
          failedFiles.push({
            path: file,
            error: result.errors.slice(0, 2000),
            language: fullPath.endsWith('.ts') ? 'typescript' : 'javascript',
            content: fs.readFileSync(fullPath, 'utf-8').slice(0, 4000),
            targetSource: this._inferSourceFromTest(file)
          });
        }
      }
    }

    return failedFiles;
  }

  _inferSourceFromTest(testPath) {
    // Convert test path to likely source path
    // e.g., "src/lib/__tests__/auth.test.ts" → "src/lib/auth.ts"
    return testPath
      .replace('/__tests__/', '/')
      .replace('/tests/', '/')
      .replace('.test.', '.')
      .replace('.spec.', '.');
  }

  _findRepoTestDirs(workDir) {
    const dirs = [];
    const candidates = [
      path.join(workDir, 'src'),
      path.join(workDir, 'tests'),
      path.join(workDir, 'test'),
      path.join(workDir, '__tests__')
    ];

    for (const dir of candidates) {
      if (fs.existsSync(dir)) {
        // Check if this dir has .test. files (recursively, up to 1 level deep check)
        try {
          const hasTests = this._hasTestFiles(dir);
          if (hasTests) dirs.push(dir);
        } catch {}
      }
    }

    return dirs;
  }

  _hasTestFiles(dir, depth = 0) {
    if (depth > 3) return false;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules') continue;
        if (entry.isFile() && (entry.name.includes('.test.') || entry.name.includes('.spec.'))) return true;
        if (entry.isDirectory() && this._hasTestFiles(path.join(dir, entry.name), depth + 1)) return true;
      }
    } catch {}
    return false;
  }

  _parseJsonResponse(response, defaultValue) {
    if (!response) return defaultValue;
    if (typeof response === 'object' && !Array.isArray(response) && !(response instanceof String)) {
      return response;
    }

    const text = typeof response === 'string' ? response : JSON.stringify(response);

    // Try direct parse
    try { return JSON.parse(text); } catch {}

    // Extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1]); } catch {}
    }

    // Try finding first { ... } or [ ... ]
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    const start = Math.min(
      firstBrace >= 0 ? firstBrace : Infinity,
      firstBracket >= 0 ? firstBracket : Infinity
    );
    if (start < Infinity) {
      const substr = text.slice(start);
      try { return JSON.parse(substr); } catch {}
    }

    return defaultValue;
  }

  _parseTestGenerationResponse(response) {
    const parsed = this._parseJsonResponse(response, { files: [] });
    if (Array.isArray(parsed)) return { files: parsed };
    if (parsed.files) return parsed;
    return { files: [] };
  }
}

module.exports = UnitTestPipeline;
