'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

    // Validate syntax of all generated .js/.ts files before running tests
    await this._validateAndFixSyntax(outputDir, writtenFiles);

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
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  maxFailures: process.env.CI ? 25 : 10,
  reporter: [
    ['json', { outputFile: '../test-results/results.json' }],
    ['list']
  ],
  use: {
    baseURL: process.env.APP_URL || '${baseUrl}',
    headless: true,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], headless: true }
    }
  ],
  timeout: process.env.CI ? 30000 : 15000,
  expect: {
    timeout: 10000
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

  /**
   * Validate syntax of generated test files and attempt AI-powered fix for broken ones.
   * Removes files that cannot be fixed to prevent Playwright from choking on parse errors.
   */
  async _validateAndFixSyntax(outputDir, writtenFiles) {
    const jsFiles = writtenFiles.filter(f => f.endsWith('.js') || f.endsWith('.mjs'));
    if (jsFiles.length === 0) return;

    // Pre-pass: fix corrupted require/import patterns before syntax check
    this._fixPlaywrightRequires(outputDir, jsFiles);
    this._fixCommonTestIssues(outputDir, jsFiles);

    const broken = [];

    for (const relPath of jsFiles) {
      const fullPath = path.join(outputDir, relPath);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const error = this._checkSyntax(content, relPath);
      if (error) {
        broken.push({ relPath, fullPath, content, error });
      }
    }

    if (broken.length === 0) {
      logger.info(`✅ All ${jsFiles.length} generated test file(s) passed syntax validation`);
      return;
    }

    logger.warn(`⚠️ ${broken.length}/${jsFiles.length} generated file(s) have syntax errors — attempting auto-fix`);

    for (const { relPath, fullPath, content, error } of broken) {
      logger.warn(`   ${relPath}: ${error}`);

      // Attempt AI-powered syntax fix
      let fixed = false;
      try {
        const fixedContent = await this._aiFixSyntax(content, error, relPath);
        if (fixedContent) {
          const recheckError = this._checkSyntax(fixedContent, relPath);
          if (!recheckError) {
            fs.writeFileSync(fullPath, fixedContent, 'utf-8');
            logger.info(`   ✅ Fixed syntax in ${relPath}`);
            fixed = true;
          } else {
            logger.warn(`   AI fix still has errors: ${recheckError}`);
          }
        }
      } catch (err) {
        logger.warn(`   AI syntax fix failed: ${err.message}`);
      }

      // If AI couldn't fix it, remove the file so it doesn't block other tests
      if (!fixed) {
        logger.warn(`   🗑️  Removing broken file: ${relPath} (would block all Playwright tests)`);
        fs.unlinkSync(fullPath);
        // Remove from writtenFiles array
        const idx = writtenFiles.indexOf(relPath);
        if (idx !== -1) writtenFiles.splice(idx, 1);
      }
    }
  }

  /**
   * Check JavaScript syntax using vm.Script (Node.js built-in parser).
   * Returns error message string if invalid, null if valid.
   */
  _checkSyntax(code, filename) {
    try {
      new vm.Script(code, { filename, displayErrors: false });
      return null;
    } catch (err) {
      // Extract concise error message (line:col + description)
      const match = err.message.match(/^(.*?)(\n|$)/);
      return match ? match[1] : err.message;
    }
  }

  /**
   * Ask AI provider to fix syntax errors in generated code.
   */
  async _aiFixSyntax(brokenCode, syntaxError, filename) {
    // Try basic auto-fix first (fast, no API call needed)
    const basicFix = this._attemptBasicSyntaxFix(brokenCode, syntaxError);
    if (basicFix) {
      const recheckError = this._checkSyntax(basicFix, filename);
      if (!recheckError) return basicFix;
    }

    // Try AI-powered fix via generateFix
    if (!this.aiProvider || !this.aiProvider.generateFix) return basicFix;

    try {
      const failureAnalysis = {
        summary: `Generated test file has a JavaScript syntax error that prevents it from being parsed.`,
        rootCause: `Syntax error in ${filename}: ${syntaxError}`,
        fixes: [{
          file: filename,
          description: `Fix the syntax error: ${syntaxError}`,
          type: 'syntax-fix'
        }]
      };

      const sourceCode = { [`test:${filename}`]: brokenCode };
      const fixes = await this.aiProvider.generateFix(failureAnalysis, sourceCode);

      if (Array.isArray(fixes) && fixes.length > 0) {
        // Apply the fix to get corrected content
        for (const fix of fixes) {
          if (fix.fixedCode && fix.originalCode) {
            const result = brokenCode.replace(fix.originalCode, fix.fixedCode);
            if (result !== brokenCode) return result;
          } else if (fix.fixedCode && !fix.originalCode) {
            // Full file replacement
            return fix.fixedCode;
          }
        }
      }
    } catch (err) {
      logger.debug(`AI syntax fix API call failed: ${err.message}`);
    }

    return basicFix;
  }

  /**
   * Attempt common automatic syntax fixes without AI.
   * Handles: unmatched parentheses on statement lines (ending with ;).
   */
  _attemptBasicSyntaxFix(code, error) {
    let fixed = code;

    // Strategy: balance parentheses ONLY on lines that are self-contained statements (end with ;)
    // Skip lines ending with { or } (multi-line block openers/closers)
    const lines = fixed.split('\n');
    let modified = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();
      
      // Only attempt fix on lines ending with ; (self-contained statements)
      if (!trimmed.endsWith(';')) continue;

      let openParens = 0;
      // Count parens ignoring string contents
      let inSingle = false, inDouble = false, inTemplate = false;
      for (let j = 0; j < trimmed.length; j++) {
        const ch = trimmed[j];
        const prev = j > 0 ? trimmed[j - 1] : '';
        
        if (prev === '\\') continue; // Skip escaped chars
        
        if (ch === "'" && !inDouble && !inTemplate) inSingle = !inSingle;
        else if (ch === '"' && !inSingle && !inTemplate) inDouble = !inDouble;
        else if (ch === '`' && !inSingle && !inDouble) inTemplate = !inTemplate;
        else if (!inSingle && !inDouble && !inTemplate) {
          if (ch === '(') openParens++;
          else if (ch === ')') openParens--;
        }
      }

      if (openParens > 0) {
        const closing = ')'.repeat(openParens);
        lines[i] = trimmed.replace(/;$/, closing + ';');
        modified = true;
      }
    }

    if (modified) {
      return lines.join('\n');
    }

    return null; // No basic fix found
  }

  /**
   * Fix corrupted require/import lines in generated Playwright test files.
   * AI sometimes generates garbage like:
   *   onPostExecute({ test, expect } = require('@playwright/test'));
   * instead of:
   *   const { test, expect } = require('@playwright/test');
   *
   * These are syntactically valid JS (function call + destructuring) so vm.Script won't catch them,
   * but they fail at runtime with ReferenceError.
   */
  _fixPlaywrightRequires(outputDir, jsFiles) {
    // Pattern: any identifier (not const/let/var) followed by destructuring require of @playwright/test
    // Examples:
    //   onPostExecute({ test, expect } = require('@playwright/test'));
    //   someGarbage({test,expect}=require("@playwright/test"));
    const corruptedRequire = /^[^/\s]*?\b(?!const\b|let\b|var\b)([a-zA-Z_$][\w$]*)\s*\(\s*\{([^}]+)\}\s*=\s*require\s*\(\s*['"]@playwright\/test['"]\s*\)\s*\)\s*;?\s*$/;

    // Also catch: missing const/let/var entirely:
    //   { test, expect } = require('@playwright/test');
    const missingDecl = /^\s*\{([^}]+)\}\s*=\s*require\s*\(\s*['"]@playwright\/test['"]\s*\)\s*;?\s*$/;

    for (const relPath of jsFiles) {
      const fullPath = path.join(outputDir, relPath);
      if (!fs.existsSync(fullPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Check for corrupted pattern: someFunc({ test, expect } = require(...));
        let match = trimmed.match(corruptedRequire);
        if (match) {
          const vars = match[2].trim();
          lines[i] = `const { ${vars} } = require('@playwright/test');`;
          logger.warn(`   Fixed corrupted require in ${relPath} line ${i + 1}: "${match[1]}(...)" → "const ..."`);
          modified = true;
          continue;
        }

        // Check for missing declaration keyword
        match = trimmed.match(missingDecl);
        if (match) {
          const vars = match[1].trim();
          lines[i] = `const { ${vars} } = require('@playwright/test');`;
          logger.warn(`   Fixed missing declaration in ${relPath} line ${i + 1}`);
          modified = true;
          continue;
        }
      }

      if (modified) {
        fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
      }
    }
  }

  /**
   * Fix common AI-generated test issues:
   * 1. Remove bogus `require('jest')` / `require('mocha')` lines (Jest/Mocha are test runners, not importable)
   * 2. Fix relative paths for unit test files that reference the app's source
   */
  _fixCommonTestIssues(outputDir, jsFiles) {
    // Patterns for bogus test framework imports that should be removed
    const bogusRequires = /^\s*(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"](jest|mocha|jasmine|chai\/register)['"]\s*\)\s*;?\s*$/;
    const bogusImports = /^\s*import\s+.*\s+from\s+['"](jest|mocha|jasmine)['"]\s*;?\s*$/;

    for (const relPath of jsFiles) {
      const fullPath = path.join(outputDir, relPath);
      if (!fs.existsSync(fullPath)) continue;

      // Only fix .test.js files (unit tests), not .spec.js (Playwright)
      if (!relPath.endsWith('.test.js') && !relPath.endsWith('.test.ts')) continue;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      let modified = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Remove bogus require('jest') / require('mocha') etc.
        if (bogusRequires.test(trimmed) || bogusImports.test(trimmed)) {
          const match = trimmed.match(/['"](jest|mocha|jasmine|chai\/register)['"]/);
          logger.warn(`   Removed bogus require('${match ? match[1] : '?'}') in ${relPath} line ${i + 1}`);
          lines[i] = `// ${trimmed} // Removed: test runner is not importable`;
          modified = true;
          continue;
        }
      }

      // Fix relative paths to project source files.
      // Generated test files are at generated-tests/tests/unit/foo.test.js
      // but AI generates paths as if the file is at tests/unit/foo.test.js.
      // Every relative require that goes up to the project root needs an extra '../'.
      // E.g. require('../../index') → require('../../../index')
      const depthInOutputDir = relPath.split(/[/\\]/).length; // e.g. tests/unit/foo.test.js = 3

      // Only fix if there's actually a depth difference (file is under generated-tests/)
      if (depthInOutputDir >= 2) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match require('../../something') or require("../../something")
          const requireMatch = line.match(/require\s*\(\s*(['"])(\.\.\/(?:\.\.\/)*[^'"]+)\1\s*\)/);
          if (requireMatch) {
            const quoteMark = requireMatch[1];
            const originalPath = requireMatch[2];
            // Count how many '../' the path has
            const dotDotCount = (originalPath.match(/\.\.\//g) || []).length;
            // If the path goes up exactly to where AI thinks the root is, add one more '../'
            if (dotDotCount === depthInOutputDir - 1) {
              const fixedPath = '../' + originalPath;
              // Verify the target exists from the actual file location
              const actualFilePath = path.join(outputDir, relPath);
              const resolvedTarget = path.resolve(path.dirname(actualFilePath), fixedPath);
              // Check if the fixed path points to an existing file (with or without extension)
              const targetExists = fs.existsSync(resolvedTarget) || 
                                   fs.existsSync(resolvedTarget + '.js') || 
                                   fs.existsSync(resolvedTarget + '.ts') ||
                                   fs.existsSync(path.join(resolvedTarget, 'index.js'));
              if (targetExists) {
                lines[i] = line.replace(
                  `require(${quoteMark}${originalPath}${quoteMark})`,
                  `require(${quoteMark}${fixedPath}${quoteMark})`
                );
                logger.info(`   Fixed relative path in ${relPath} line ${i + 1}: '${originalPath}' → '${fixedPath}'`);
                modified = true;
              }
            }
          }
        }
      }

      if (modified) {
        fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
      }
    }
  }
}

module.exports = TestGenerator;
