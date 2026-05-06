'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class TestGenerator {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  /**
   * Generate tests for all enabled test types.
   * @param {string} workDir - Working directory
   * @param {object} analysisResult - Code analysis results
   * @param {string[]} testTypes - Types of tests to generate
   * @param {object} techStack - Technology stack info
   * @param {object} testGaps - Identified test gaps (optional)
   */
  async generateAll(workDir, analysisResult, testTypes, techStack, testGaps = null) {
    const outputDir = path.join(workDir, 'generated-tests');
    fs.mkdirSync(outputDir, { recursive: true });

    const generated = {};

    // Separate unit/integration tests from Playwright tests
    const unitTestTypes = testTypes.filter(t => ['unit', 'integration'].includes(t));
    const playwrightTestTypes = testTypes.filter(t => !['unit', 'integration'].includes(t));

    // Generate unit tests (for backend) - only for gaps if testGaps provided
    for (const testType of unitTestTypes) {
      // Get gaps from testGaps object
      // - null/undefined: generate full coverage
      // - []: skip (full coverage exists) 
      // - [...]: generate only for these gaps
      const gaps = testGaps && testGaps[testType] !== undefined ? testGaps[testType] : null;
      
      // Skip only if explicitly empty array (full coverage exists)
      if (gaps !== null && Array.isArray(gaps) && gaps.length === 0) {
        logger.info(`⏭️  Skipping ${testType} tests - full coverage already exists`);
        generated[testType] = { files: [], skipped: true, reason: 'Full coverage exists' };
        continue;
      }

      const gapCount = gaps === null ? 'all' : gaps.length;
      logger.info(`Generating ${testType} tests for ${gapCount} scenario(s)...`);
      try {
        const result = await this.generate(workDir, analysisResult, testType, techStack, gaps);
        generated[testType] = result;
        logger.info(`Generated ${result.files.length} ${testType} test file(s)`);
      } catch (err) {
        logger.error(`Failed to generate ${testType} tests: ${err.message}`);
        generated[testType] = { files: [], error: err.message };
      }
    }

    // Generate Playwright tests (for E2E/API/etc) - only for gaps if testGaps provided
    for (const testType of playwrightTestTypes) {
      // Get gaps from testGaps object
      // - null/undefined: generate full coverage
      // - []: skip (full coverage exists)
      // - [...]: generate only for these gaps
      const gaps = testGaps && testGaps[testType] !== undefined ? testGaps[testType] : null;
      
      // Skip only if explicitly empty array (full coverage exists)
      if (gaps !== null && Array.isArray(gaps) && gaps.length === 0) {
        logger.info(`⏭️  Skipping ${testType} tests - full coverage already exists`);
        generated[testType] = { files: [], skipped: true, reason: 'Full coverage exists' };
        continue;
      }

      const gapCount = gaps === null ? 'all' : gaps.length;
      logger.info(`Generating ${testType} tests for ${gapCount} scenario(s)...`);
      try {
        const result = await this.generate(workDir, analysisResult, testType, techStack, gaps);
        generated[testType] = result;
        logger.info(`Generated ${result.files.length} ${testType} test file(s)`);
      } catch (err) {
        logger.error(`Failed to generate ${testType} tests: ${err.message}`);
        generated[testType] = { files: [], error: err.message };
      }
    }

    // Generate Playwright config only if there are Playwright tests
    if (playwrightTestTypes.length > 0 && playwrightTestTypes.some(t => generated[t]?.files?.length > 0)) {
      await this.generatePlaywrightConfig(outputDir, techStack, playwrightTestTypes);
    }

    // Generate Jest/Mocha config for unit tests
    if (unitTestTypes.length > 0 && unitTestTypes.some(t => generated[t]?.files?.length > 0)) {
      await this.generateUnitTestConfig(outputDir, techStack);
    }

    return generated;
  }

  /**
   * Generate tests for a specific test type.
   * Uses chunked generation for large codebases to avoid AI context truncation.
   * @param {object} gaps - Identified test gaps for this test type (optional)
   */
  async generate(workDir, analysisResult, testType, techStack, gaps = null) {
    const outputDir = path.join(workDir, 'generated-tests');
    fs.mkdirSync(outputDir, { recursive: true });

    // Estimate context size — if too large, use chunked generation
    const estimatedSize = JSON.stringify(analysisResult).length;
    const MAX_SAFE_CONTEXT = 80000; // Safe limit before truncation becomes destructive

    let allFiles = [];

    if (estimatedSize > MAX_SAFE_CONTEXT && ['e2e', 'api'].includes(testType)) {
      logger.info(`📦 Large codebase detected (${(estimatedSize / 1024).toFixed(0)}KB context) — using chunked generation for ${testType}`);
      allFiles = await this._generateInChunks(workDir, analysisResult, testType, techStack, gaps);
    } else {
      // Standard single-prompt generation
      const result = await this._generateSingle(analysisResult, testType, techStack, gaps);
      allFiles = result;
    }

    // Write all generated files
    const writtenFiles = [];
    for (const file of allFiles) {
      if (!file.path || !file.content) continue;

      // Sanitize file path to prevent directory traversal
      const safePath = file.path.replace(/\.\./g, '').replace(/^\//, '');
      const fullPath = path.join(outputDir, safePath);
      const dir = path.dirname(fullPath);

      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, file.content, 'utf-8');
      writtenFiles.push(safePath);
      logger.debug(`Written test file: ${safePath}`);
    }

    return { files: writtenFiles, gaps: gaps ? gaps.length : 0 };
  }

  /**
   * Standard single-prompt generation (small codebases).
   */
  async _generateSingle(analysisResult, testType, techStack, gaps) {
    const enhancedAnalysis = {
      ...analysisResult,
      testGaps: gaps,
      generateFor: gaps ? 'gaps-only' : 'full-coverage'
    };

    const result = await this.aiProvider.generateTests(enhancedAnalysis, testType, techStack);

    if (!result || !result.files || !Array.isArray(result.files)) {
      logger.warn(`AI returned no test files for ${testType}`);
      return [];
    }
    return result.files;
  }

  /**
   * Chunked generation for large codebases.
   * Splits scenarios into batches and generates focused tests per batch.
   */
  async _generateInChunks(workDir, analysisResult, testType, techStack, gaps) {
    const chunks = this._buildChunks(analysisResult, testType, gaps);
    
    if (chunks.length === 0) {
      logger.warn(`No chunks identified for ${testType} — falling back to single generation`);
      return this._generateSingle(analysisResult, testType, techStack, gaps);
    }

    logger.info(`🔄 Generating ${testType} tests in ${chunks.length} chunk(s):`);
    chunks.forEach((chunk, i) => {
      logger.info(`   Chunk ${i + 1}: ${chunk.name} (${chunk.scenarios.length} scenarios)`);
    });

    const allFiles = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      logger.info(`\n📝 Generating chunk ${i + 1}/${chunks.length}: ${chunk.name}...`);

      // Build focused context for this chunk only
      const focusedAnalysis = this._buildFocusedContext(analysisResult, chunk, testType);

      try {
        const result = await this.aiProvider.generateTests(focusedAnalysis, testType, techStack);

        if (result && result.files && Array.isArray(result.files)) {
          // Prefix chunk index to avoid file name collisions between chunks
          const chunkFiles = result.files.map(file => ({
            ...file,
            path: file.path // Keep original path — AI should give unique names per chunk
          }));
          allFiles.push(...chunkFiles);
          logger.info(`   ✅ Chunk ${i + 1} generated ${chunkFiles.length} file(s)`);
        } else {
          logger.warn(`   ⚠️ Chunk ${i + 1} (${chunk.name}) returned no files`);
        }
      } catch (err) {
        logger.error(`   ❌ Chunk ${i + 1} (${chunk.name}) failed: ${err.message}`);
      }
    }

    logger.info(`\n✅ Chunked generation complete: ${allFiles.length} total file(s) across ${chunks.length} chunks`);
    return allFiles;
  }

  /**
   * Build chunks based on test type and analysis results.
   * E2E: chunk by page/route groups
   * API: chunk by resource/controller groups
   */
  _buildChunks(analysisResult, testType, gaps) {
    const chunks = [];
    const MAX_SCENARIOS_PER_CHUNK = 10;

    if (testType === 'e2e') {
      // Chunk by route groups (pages/features)
      const routes = analysisResult.analysis?.routes || analysisResult.surface?.routes || [];
      const components = analysisResult.analysis?.components || analysisResult.surface?.components || [];
      
      // Group routes by top-level path segment
      const routeGroups = {};
      for (const route of routes) {
        const routePath = typeof route === 'string' ? route : (route.path || route.route || '');
        const segment = routePath.split('/').filter(Boolean)[0] || 'home';
        if (!routeGroups[segment]) routeGroups[segment] = [];
        routeGroups[segment].push(route);
      }

      // Create chunks from route groups
      for (const [segment, groupRoutes] of Object.entries(routeGroups)) {
        // Split large groups into sub-chunks
        for (let i = 0; i < groupRoutes.length; i += MAX_SCENARIOS_PER_CHUNK) {
          const batch = groupRoutes.slice(i, i + MAX_SCENARIOS_PER_CHUNK);
          const chunkName = groupRoutes.length > MAX_SCENARIOS_PER_CHUNK 
            ? `${segment} (part ${Math.floor(i / MAX_SCENARIOS_PER_CHUNK) + 1})`
            : segment;
          chunks.push({
            name: chunkName,
            scenarios: batch,
            type: 'routes',
            relatedComponents: components.filter(c => {
              const cPath = typeof c === 'string' ? c : (c.file || c.path || '');
              return cPath.toLowerCase().includes(segment.toLowerCase());
            })
          });
        }
      }

      // If no routes found, chunk by components
      if (chunks.length === 0 && components.length > 0) {
        for (let i = 0; i < components.length; i += MAX_SCENARIOS_PER_CHUNK) {
          const batch = components.slice(i, i + MAX_SCENARIOS_PER_CHUNK);
          chunks.push({
            name: `components-group-${Math.floor(i / MAX_SCENARIOS_PER_CHUNK) + 1}`,
            scenarios: batch,
            type: 'components'
          });
        }
      }

    } else if (testType === 'api') {
      // Chunk by API resource/controller
      const endpoints = analysisResult.analysis?.apiEndpoints || analysisResult.surface?.apiEndpoints || [];
      
      // Group endpoints by resource (first path segment after /api/)
      const endpointGroups = {};
      for (const endpoint of endpoints) {
        const epPath = typeof endpoint === 'string' ? endpoint : (endpoint.path || endpoint.route || '');
        const parts = epPath.replace(/^\/api\//, '/').split('/').filter(Boolean);
        const resource = parts[0] || 'root';
        if (!endpointGroups[resource]) endpointGroups[resource] = [];
        endpointGroups[resource].push(endpoint);
      }

      // Create chunks from endpoint groups
      for (const [resource, groupEndpoints] of Object.entries(endpointGroups)) {
        for (let i = 0; i < groupEndpoints.length; i += MAX_SCENARIOS_PER_CHUNK) {
          const batch = groupEndpoints.slice(i, i + MAX_SCENARIOS_PER_CHUNK);
          const chunkName = groupEndpoints.length > MAX_SCENARIOS_PER_CHUNK
            ? `API: ${resource} (part ${Math.floor(i / MAX_SCENARIOS_PER_CHUNK) + 1})`
            : `API: ${resource}`;
          chunks.push({
            name: chunkName,
            scenarios: batch,
            type: 'endpoints'
          });
        }
      }
    }

    // If gaps are specified, override chunks with gap-based chunking
    if (gaps && gaps.length > 0) {
      chunks.length = 0; // Clear existing chunks
      for (let i = 0; i < gaps.length; i += MAX_SCENARIOS_PER_CHUNK) {
        const batch = gaps.slice(i, i + MAX_SCENARIOS_PER_CHUNK);
        chunks.push({
          name: `gaps-batch-${Math.floor(i / MAX_SCENARIOS_PER_CHUNK) + 1}`,
          scenarios: batch,
          type: 'gaps'
        });
      }
    }

    return chunks;
  }

  /**
   * Build a focused, smaller context for a single chunk.
   * Only includes relevant analysis data for the chunk's scenarios.
   */
  _buildFocusedContext(fullAnalysis, chunk, testType) {
    // Start with minimal analysis structure
    const focused = {
      generateFor: chunk.type === 'gaps' ? 'gaps-only' : 'full-coverage',
      testGaps: chunk.type === 'gaps' ? chunk.scenarios : null,
      chunkInfo: {
        name: chunk.name,
        totalScenarios: chunk.scenarios.length,
        type: chunk.type
      }
    };

    // Include only relevant routes/endpoints for this chunk
    if (chunk.type === 'routes' || testType === 'e2e') {
      focused.routes = chunk.scenarios;
      focused.components = chunk.relatedComponents || [];
      // Include testing strategy for e2e if available
      if (fullAnalysis.analysis?.deepAnalysis?.testingStrategy?.e2e) {
        focused.testingStrategy = { e2e: fullAnalysis.analysis.deepAnalysis.testingStrategy.e2e };
      }
    } else if (chunk.type === 'endpoints' || testType === 'api') {
      focused.apiEndpoints = chunk.scenarios;
      // Include API contracts if available
      if (fullAnalysis.analysis?.deepAnalysis?.apiContracts) {
        // Filter API contracts to only those matching this chunk's endpoints
        const chunkPaths = chunk.scenarios.map(s => typeof s === 'string' ? s : (s.path || s.route || ''));
        focused.apiContracts = fullAnalysis.analysis.deepAnalysis.apiContracts.filter(c => 
          chunkPaths.some(p => (c.path || '').includes(p) || p.includes(c.path || ''))
        );
      }
      if (fullAnalysis.analysis?.deepAnalysis?.testingStrategy?.api) {
        focused.testingStrategy = { api: fullAnalysis.analysis.deepAnalysis.testingStrategy.api };
      }
    }

    // Include relevant file contents (only files related to this chunk)
    if (fullAnalysis.analysis?.analyzedFiles) {
      const relevantFiles = {};
      const chunkKeywords = chunk.scenarios.map(s => {
        if (typeof s === 'string') return s;
        return s.path || s.route || s.file || s.name || '';
      }).filter(Boolean);

      // Get the deep-dive file contents if available
      const deepContext = fullAnalysis.analysis?.deepAnalysis;
      if (deepContext && typeof deepContext === 'object') {
        // Include only files relevant to this chunk's scenarios
        for (const filePath of fullAnalysis.analysis.analyzedFiles) {
          const fileRelevant = chunkKeywords.some(keyword => {
            const normalizedFile = filePath.toLowerCase();
            const normalizedKeyword = keyword.toLowerCase().replace(/[\/\\]/g, '/');
            // Check if file name or path contains any keyword
            return normalizedFile.includes(normalizedKeyword.split('/').pop()) ||
                   normalizedKeyword.includes(normalizedFile.split('/').pop());
          });
          if (fileRelevant) {
            relevantFiles[filePath] = true;
          }
        }
      }
      focused.relevantFiles = Object.keys(relevantFiles);
    }

    // Include app type and auth info (small, always useful)
    if (fullAnalysis.analysis?.aiRecommendations?.appType) {
      focused.appType = fullAnalysis.analysis.aiRecommendations.appType;
    }
    if (fullAnalysis.analysis?.deepAnalysis?.authFlow) {
      focused.authFlow = fullAnalysis.analysis.deepAnalysis.authFlow;
    }

    // Include structure stats (small)
    if (fullAnalysis.structure?.stats) {
      focused.projectStats = {
        totalFiles: fullAnalysis.structure.stats.totalFiles,
        totalSize: fullAnalysis.structure.stats.totalSize
      };
    }

    return focused;
  }

  /**
   * Generate a Playwright configuration file tailored to the target app.
   */
  async generatePlaywrightConfig(outputDir, techStack, testTypes) {
    const baseUrl = techStack?.frontend?.port
      ? `http://localhost:${techStack.frontend.port}`
      : techStack?.backend?.port
        ? `http://localhost:${techStack.backend.port}`
        : 'http://localhost:3000';

    const testDirs = [];
    if (testTypes.includes('e2e')) testDirs.push('**/e2e/**/*.spec.js');
    if (testTypes.includes('api')) testDirs.push('**/api/**/*.spec.js');
    if (testTypes.includes('visual')) testDirs.push('**/visual/**/*.spec.js');
    if (testTypes.includes('accessibility')) testDirs.push('**/accessibility/**/*.spec.js');
    if (testTypes.includes('performance')) testDirs.push('**/performance/**/*.spec.js');
    // Catch-all for any spec files
    testDirs.push('**/*.spec.js');

    const config = `// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ${JSON.stringify(testDirs)},
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['json', { outputFile: '../test-results/results.json' }],
    ['html', { outputFolder: '../playwright-report', open: 'never' }],
    ['list']
  ],
  use: {
    baseURL: process.env.APP_URL || '${baseUrl}',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], headless: true }
    }
  ],
  timeout: 30000,
  expect: {
    timeout: 5000
  }
});
`;

    const configPath = path.join(outputDir, 'playwright.config.js');
    fs.writeFileSync(configPath, config, 'utf-8');
    logger.info('Generated playwright.config.js');
  }

  /**
   * Generate Jest configuration for unit tests
   */
  async generateUnitTestConfig(outputDir, techStack) {
    const config = `// Jest configuration for unit tests
module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/unit/**/*.test.js',
    '**/tests/integration/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '.*\\\.spec\\\.js$'
  ],
  collectCoverage: true,
  coverageDirectory: '../coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 10000,
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/'
  ]
};
`;

    const configPath = path.join(outputDir, 'jest.config.js');
    fs.writeFileSync(configPath, config, 'utf-8');
    logger.info('Generated jest.config.js for unit tests');
  }
}

module.exports = TestGenerator;

module.exports = TestGenerator;
