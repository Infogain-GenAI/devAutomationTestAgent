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
   */
  async generateAll(workDir, analysisResult, testTypes, techStack) {
    const outputDir = path.join(workDir, 'generated-tests');
    fs.mkdirSync(outputDir, { recursive: true });

    const generated = {};

    for (const testType of testTypes) {
      logger.info(`Generating ${testType} tests...`);
      try {
        const result = await this.generate(workDir, analysisResult, testType, techStack);
        generated[testType] = result;
        logger.info(`Generated ${result.files.length} ${testType} test file(s)`);
      } catch (err) {
        logger.error(`Failed to generate ${testType} tests: ${err.message}`);
        generated[testType] = { files: [], error: err.message };
      }
    }

    // Generate Playwright config
    await this.generatePlaywrightConfig(outputDir, techStack, testTypes);

    return generated;
  }

  /**
   * Generate tests for a specific test type.
   */
  async generate(workDir, analysisResult, testType, techStack) {
    const result = await this.aiProvider.generateTests(analysisResult, testType, techStack);

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

    return { files: writtenFiles };
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
}

module.exports = TestGenerator;
