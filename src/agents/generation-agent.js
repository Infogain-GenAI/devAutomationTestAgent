'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const BaseSubAgent = require('./base-sub-agent');

/**
 * Generation Agent — Responsible for:
 * - Code analysis (structure scan, surface analysis, deep-dive)
 * - Application documentation generation
 * - Test scenario identification
 * - Unit test generation
 * - Automation (Playwright) test script generation
 *
 * Iterates internally to improve generated test quality and coverage scope.
 */
class GenerationAgent extends BaseSubAgent {
  constructor(config, dependencies) {
    super('generation', config, dependencies);
    this.codeAnalyzer = dependencies.codeAnalyzer;
    this.documentationGenerator = dependencies.documentationGenerator;
    this.testGenerator = dependencies.testGenerator;
    this.testCoverageScanner = dependencies.testCoverageScanner;
    this.stackDetector = dependencies.stackDetector;
  }

  /**
   * Run a single iteration of the generation agent.
   * Iteration 0: Full analysis + documentation + initial test generation.
   * Iteration 1+: Re-analyze gaps and generate additional tests for uncovered areas.
   */
  async _runIteration(context, iteration, previousResult = null) {
    const { workDir, techStack, existingTests, testTypes } = context;

    if (iteration === 0) {
      return this._initialGeneration(context);
    }

    // Subsequent iterations: identify remaining gaps and generate additional tests
    return this._iterativeGeneration(context, previousResult);
  }

  /**
   * Initial generation: full analysis pipeline + documentation + all test generation.
   */
  async _initialGeneration(context) {
    const { workDir, techStack, testTypes, kbResult } = context;
    const artifacts = [];
    const issues = [];

    // ── Phase 1: Code Analysis ──────────────────────────────────
    logger.info('[generation] Phase 1: Code Analysis');
    let codeAnalysis;
    if (kbResult?.source === 'cache' && kbResult.kb?.codeAnalysis) {
      codeAnalysis = kbResult.kb.codeAnalysis;
      logger.info('[generation] ✅ Reused code analysis from Knowledge Base cache');
      artifacts.push({ type: 'analysis', path: null, description: 'Code analysis result (cached)' });
    } else {
      try {
        codeAnalysis = await this.codeAnalyzer.analyze(workDir, techStack);
        logger.info(`[generation] ✅ Code analysis complete — ${codeAnalysis.structure.stats.totalFiles} files scanned`);
        artifacts.push({ type: 'analysis', path: null, description: 'Code analysis result' });
      } catch (err) {
        logger.error(`[generation] Code analysis failed: ${err.message}`);
        throw err;
      }
    }

    // ── Phase 2: Documentation Generation ───────────────────────
    logger.info('[generation] Phase 2: Documentation Generation');
    let appDocumentation = null;
    try {
      const existingDocJson = path.join(workDir, 'generated-tests', 'application-documentation.json');
      const existingDocMd = path.join(workDir, 'generated-tests', 'APPLICATION-DOCUMENTATION.md');
      const forceRegenDocs = process.env.FORCE_REGENERATE_DOCS === 'true';

      if (!forceRegenDocs && fs.existsSync(existingDocJson)) {
        appDocumentation = JSON.parse(fs.readFileSync(existingDocJson, 'utf-8'));
        artifacts.push({ type: 'documentation', path: existingDocJson, description: 'Application documentation (reused)' });
        logger.info('[generation] ✅ Reusing existing application-documentation.json (skipped regeneration)');
      } else if (!forceRegenDocs && fs.existsSync(existingDocMd)) {
        artifacts.push({ type: 'documentation', path: existingDocMd, description: 'Application documentation (reused markdown)' });
        logger.info('[generation] ✅ Reusing existing APPLICATION-DOCUMENTATION.md (skipped regeneration)');
      } else {
        const docResult = await this.documentationGenerator.generateDocumentation(
          workDir, codeAnalysis, techStack
        );
        appDocumentation = docResult.documentation;
        artifacts.push({ type: 'documentation', path: docResult.filePath, description: 'Application documentation' });
        const featureCount = Array.isArray(appDocumentation?.features) ? appDocumentation.features.length : 0;
        const endpointCount = Array.isArray(appDocumentation?.apiEndpoints) ? appDocumentation.apiEndpoints.length : 0;
        logger.info(`[generation] ✅ Documentation generated — ${featureCount} features, ${endpointCount} endpoints`);
      }
    } catch (err) {
      logger.warn(`[generation] Documentation generation failed (non-fatal): ${err.message}`);
      issues.push({ phase: 'documentation', error: err.message });
    }

    // ── Phase 3: Scan Existing Tests ────────────────────────────
    logger.info('[generation] Phase 3: Scanning Existing Tests');
    const existingTests = await this.testCoverageScanner.scanExistingTests(workDir, { includeGenerated: true });
    const testGaps = await this.testCoverageScanner.identifyTestGaps(workDir, codeAnalysis, existingTests);
    const testPlan = this.testCoverageScanner.filterTestTypesToGenerate(testTypes, existingTests, testGaps);

    logger.info('[generation] Test Generation Plan:');
    Object.entries(testPlan).forEach(([type, plan]) => {
      if (plan.generate) {
        logger.info(`   ✅ ${type}: Generate ${plan.scope} tests (${plan.reason})`);
      } else {
        logger.info(`   ⏭️  ${type}: Skip (${plan.reason})`);
      }
    });

    // ── Phase 4: Test Generation ────────────────────────────────
    logger.info('[generation] Phase 4: Test Generation');
    const typesToGenerate = Object.entries(testPlan)
      .filter(([_, plan]) => plan.generate)
      .map(([type]) => type);

    let generated = {};
    if (typesToGenerate.length > 0) {
      // Build gaps object
      const gapsForGeneration = {};
      typesToGenerate.forEach(type => {
        if (testPlan[type].scope === 'full') {
          gapsForGeneration[type] = null;
        } else if (testPlan[type].scope === 'partial') {
          gapsForGeneration[type] = testPlan[type].targets || [];
        }
      });

      generated = await this.testGenerator.generateAll(
        workDir, codeAnalysis, typesToGenerate, techStack, gapsForGeneration,
        { appDocumentation, existingTests }
      );

      const totalFiles = Object.values(generated).reduce((sum, g) => sum + (g.files?.length || 0), 0);
      logger.info(`[generation] ✅ Generated ${totalFiles} test file(s)`);
      artifacts.push({ type: 'tests', path: path.join(workDir, 'generated-tests'), description: `${totalFiles} test files` });
    } else {
      logger.info('[generation] ✅ All required tests already exist — skipping generation');
    }

    // Calculate initial estimated coverage based on gaps filled
    const totalEndpoints = (codeAnalysis.surface?.apiEndpoints || []).length + (codeAnalysis.surface?.routes || []).length;
    const coveredByExisting = Object.values(existingTests).reduce((sum, arr) => sum + arr.length, 0);
    const newlyGenerated = Object.values(generated).reduce((sum, g) => sum + (g.files?.length || 0), 0);
    const estimatedCoverage = totalEndpoints > 0
      ? Math.min(100, Math.round(((coveredByExisting + newlyGenerated) / Math.max(totalEndpoints, 1)) * 100))
      : (newlyGenerated > 0 ? 50 : 0); // Conservative estimate

    return {
      status: 'success',
      complete: typesToGenerate.length === 0, // Complete if nothing to generate
      coverage: estimatedCoverage,
      codeAnalysis,
      appDocumentation,
      existingTests,
      testGaps,
      testPlan,
      generated,
      artifacts,
      issues,
      typesToGenerate
    };
  }

  /**
   * Iterative generation: re-scan for gaps and generate additional tests.
   * Files generated in prior iterations are now on disk and will be detected by the scanner.
   */
  async _iterativeGeneration(context, previousResult) {
    const { workDir, techStack, testTypes } = context;
    const codeAnalysis = previousResult.codeAnalysis;
    const appDocumentation = previousResult.appDocumentation;
    const artifacts = [];

    // Re-scan for test gaps — includes generated-tests/ from prior iterations
    logger.info(`[generation] Re-scanning for remaining test gaps (iteration ${this.currentIteration + 1})...`);
    const existingTests = await this.testCoverageScanner.scanExistingTests(workDir, { includeGenerated: true });
    const testGaps = await this.testCoverageScanner.identifyTestGaps(workDir, codeAnalysis, existingTests);
    const testPlan = this.testCoverageScanner.filterTestTypesToGenerate(testTypes, existingTests, testGaps);

    const typesToGenerate = Object.entries(testPlan)
      .filter(([_, plan]) => plan.generate)
      .map(([type]) => type);

    if (typesToGenerate.length === 0) {
      logger.info('[generation] ✅ No additional gaps found — generation complete');
      return { ...previousResult, complete: true };
    }

    logger.info(`[generation] ${typesToGenerate.length} type(s) still have gaps: ${typesToGenerate.join(', ')}`);

    // Generate tests for remaining gaps
    const gapsForGeneration = {};
    typesToGenerate.forEach(type => {
      if (testPlan[type].scope === 'full') {
        gapsForGeneration[type] = null;
      } else {
        gapsForGeneration[type] = testPlan[type].targets || [];
      }
    });

    const generated = await this.testGenerator.generateAll(
      workDir, codeAnalysis, typesToGenerate, techStack, gapsForGeneration,
      { appDocumentation, existingTests }
    );

    const totalFiles = Object.values(generated).reduce((sum, g) => sum + (g.files?.length || 0), 0);
    logger.info(`[generation] Generated ${totalFiles} additional test file(s) in iteration ${this.currentIteration + 1}`);

    // Merge with previous generated files
    const mergedGenerated = { ...previousResult.generated };
    Object.entries(generated).forEach(([type, result]) => {
      if (mergedGenerated[type]) {
        mergedGenerated[type].files = [...(mergedGenerated[type].files || []), ...(result.files || [])];
      } else {
        mergedGenerated[type] = result;
      }
    });

    // Re-estimate coverage
    const totalEndpoints = (codeAnalysis.surface?.apiEndpoints || []).length + (codeAnalysis.surface?.routes || []).length;
    const coveredNow = Object.values(existingTests).reduce((sum, arr) => sum + arr.length, 0);
    const allGenerated = Object.values(mergedGenerated).reduce((sum, g) => sum + (g.files?.length || 0), 0);
    const estimatedCoverage = totalEndpoints > 0
      ? Math.min(100, Math.round(((coveredNow + allGenerated) / Math.max(totalEndpoints, 1)) * 100))
      : Math.min(100, previousResult.coverage + 15);

    return {
      ...previousResult,
      status: 'success',
      complete: totalFiles === 0,
      coverage: estimatedCoverage,
      existingTests,
      testGaps,
      testPlan,
      generated: mergedGenerated,
      artifacts: [...previousResult.artifacts, ...artifacts]
    };
  }

  /**
   * Override: generation agent is "complete" when no gaps remain.
   */
  _isComplete(result) {
    return result && result.complete === true;
  }
}

module.exports = GenerationAgent;
