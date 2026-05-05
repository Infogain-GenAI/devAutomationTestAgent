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
   * @param {object} gaps - Identified test gaps for this test type (optional)
   */
  async generate(workDir, analysisResult, testType, techStack, gaps = null) {
    // If gaps are provided, include them in the analysis for targeted test generation
    const enhancedAnalysis = {
      ...analysisResult,
      testGaps: gaps,
      generateFor: gaps ? 'gaps-only' : 'full-coverage'
    };

    const result = await this.aiProvider.generateTests(enhancedAnalysis, testType, techStack);

    if (!result || !result.files || !Array.isArray(result.files)) {
      logger.warn(`AI returned no test files for ${testType}`);
      return { files: [] };
    }

    const outputDir = path.join(workDir, 'generated-tests');
    const writtenFiles = [];

    for (const file of result.files) {
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
   * Generate a Playwright configuration file tailored to the target app.
   */
  async generatePlaywrightConfig(outputDir, techStack, testTypes) {
    const baseUrl = techStack?.frontend?.port
      ? `http://localhost:${techStack.frontend.port}`
      : techStack?.backend?.port
        ? `http://localhost:${techStack.backend.port}`
        : 'http://localhost:3000';

    const testDirs = [];
    if (testTypes.includes('e2e')) testDirs.push('./e2e/**/*.spec.js');
    if (testTypes.includes('api')) testDirs.push('./api/**/*.spec.js');
    if (testTypes.includes('visual')) testDirs.push('./visual/**/*.spec.js');
    if (testTypes.includes('accessibility')) testDirs.push('./accessibility/**/*.spec.js');
    if (testTypes.includes('performance')) testDirs.push('./performance/**/*.spec.js');

    const config = `// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
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
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
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
