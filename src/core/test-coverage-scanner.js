'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Scans repository for existing tests and identifies coverage gaps
 */
class TestCoverageScanner {
  constructor() {
    this.testPatterns = {
      unit: [
        '**/*.test.js', '**/*.test.ts', '**/*.test.jsx', '**/*.test.tsx',
        '**/*.spec.js', '**/*.spec.ts', '**/*.spec.jsx', '**/*.spec.tsx',
        '**/test/**/*.js', '**/test/**/*.ts',
        '**/tests/**/*.js', '**/tests/**/*.ts',
        '**/__tests__/**/*.js', '**/__tests__/**/*.ts'
      ],
      e2e: [
        '**/e2e/**/*.spec.js', '**/e2e/**/*.spec.ts',
        '**/e2e-tests/**/*.js', '**/e2e-tests/**/*.ts',
        '**/playwright/**/*.spec.js', '**/cypress/**/*.spec.js',
        '**/tests/e2e/**/*.js'
      ],
      integration: [
        '**/integration/**/*.test.js', '**/integration/**/*.spec.js',
        '**/tests/integration/**/*.js'
      ],
      api: [
        '**/api/**/*.test.js', '**/api/**/*.spec.js',
        '**/tests/api/**/*.js'
      ]
    };

    this.ignoreDirectories = new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage',
      '.next', '.nuxt', '__pycache__', 'venv', '.venv',
      'generated-tests' // Don't scan our own generated tests
    ]);
  }

  /**
   * Scan repository for existing tests
   */
  async scanExistingTests(workDir) {
    logger.info('🔍 Scanning repository for existing tests...');

    const existingTests = {
      unit: [],
      integration: [],
      e2e: [],
      api: [],
      visual: [],
      accessibility: [],
      performance: []
    };

    const testFiles = this._findTestFiles(workDir);
    
    for (const testFile of testFiles) {
      const relativePath = path.relative(workDir, testFile);
      const testType = this._classifyTestFile(relativePath, testFile);
      
      if (testType && existingTests[testType]) {
        const coverage = await this._analyzeTestCoverage(testFile);
        existingTests[testType].push({
          file: relativePath,
          ...coverage
        });
      }
    }

    const totalTests = Object.values(existingTests).reduce((sum, arr) => sum + arr.length, 0);
    logger.info(`✅ Found ${totalTests} existing test files:`);
    Object.entries(existingTests).forEach(([type, tests]) => {
      if (tests.length > 0) {
        logger.info(`   - ${type}: ${tests.length} files`);
      }
    });

    return existingTests;
  }

  /**
   * Analyze code coverage and identify missing test scenarios
   */
  async identifyTestGaps(workDir, codeAnalysis, existingTests) {
    logger.info('🎯 Identifying test coverage gaps...');

    const gaps = {
      unit: [],
      integration: [],
      e2e: [],
      api: []
    };

    // Analyze backend files for unit test gaps
    const backendFiles = this._extractBackendFiles(codeAnalysis.structure);
    for (const file of backendFiles) {
      if (!this._hasTestCoverage(file, existingTests.unit, 'unit')) {
        gaps.unit.push({
          file: file.path,
          type: file.type,
          reason: 'No unit test found',
          priority: this._calculatePriority(file)
        });
      }
    }

    // Analyze API endpoints for API test gaps
    if (codeAnalysis.endpoints) {
      for (const endpoint of codeAnalysis.endpoints) {
        if (!this._hasEndpointCoverage(endpoint, existingTests.api)) {
          gaps.api.push({
            endpoint: `${endpoint.method} ${endpoint.path}`,
            file: endpoint.file,
            reason: 'No API test found',
            priority: 'high'
          });
        }
      }
    }

    // Analyze routes for E2E test gaps
    if (codeAnalysis.routes) {
      for (const route of codeAnalysis.routes) {
        if (!this._hasRouteCoverage(route, existingTests.e2e)) {
          gaps.e2e.push({
            route: route.path,
            file: route.file,
            reason: 'No E2E test found',
            priority: this._calculateRoutePriority(route)
          });
        }
      }
    }

    const totalGaps = Object.values(gaps).reduce((sum, arr) => sum + arr.length, 0);
    logger.info(`📋 Identified ${totalGaps} test coverage gaps:`);
    Object.entries(gaps).forEach(([type, items]) => {
      if (items.length > 0) {
        logger.info(`   - ${type}: ${items.length} gaps`);
      }
    });

    return gaps;
  }

  /**
   * Filter test types to only generate missing tests
   */
  filterTestTypesToGenerate(requestedTypes, existingTests, gaps) {
    const typesToGenerate = {};

    for (const testType of requestedTypes) {
      const existing = existingTests[testType] || [];
      const missing = gaps[testType] || [];

      if (existing.length === 0) {
        // No existing tests - generate all
        typesToGenerate[testType] = {
          generate: true,
          reason: 'No existing tests found',
          scope: 'full',
          targets: missing
        };
      } else if (missing.length > 0) {
        // Some tests exist but gaps identified - generate for gaps only
        typesToGenerate[testType] = {
          generate: true,
          reason: `${missing.length} coverage gaps found`,
          scope: 'partial',
          targets: missing,
          existing: existing.length
        };
      } else {
        // Full coverage exists - skip generation
        typesToGenerate[testType] = {
          generate: false,
          reason: 'Full coverage already exists',
          scope: 'none',
          existing: existing.length
        };
      }
    }

    return typesToGenerate;
  }

  /**
   * Find all test files in the repository
   */
  _findTestFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!this.ignoreDirectories.has(entry.name)) {
          this._findTestFiles(fullPath, files);
        }
      } else if (entry.isFile()) {
        if (this._isTestFile(entry.name)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  /**
   * Check if file is a test file
   */
  _isTestFile(filename) {
    return (
      filename.includes('.test.') ||
      filename.includes('.spec.') ||
      filename.endsWith('Test.js') ||
      filename.endsWith('Test.ts') ||
      filename.endsWith('Spec.js') ||
      filename.endsWith('Spec.ts')
    );
  }

  /**
   * Classify test file type
   */
  _classifyTestFile(relativePath, fullPath) {
    const lowerPath = relativePath.toLowerCase();
    
    // Check directory structure
    if (lowerPath.includes('/e2e/') || lowerPath.includes('/e2e-tests/') || 
        lowerPath.includes('playwright') || lowerPath.includes('cypress')) {
      return 'e2e';
    }
    
    if (lowerPath.includes('/api/')) {
      return 'api';
    }
    
    if (lowerPath.includes('/integration/')) {
      return 'integration';
    }
    
    if (lowerPath.includes('visual') || lowerPath.includes('screenshot')) {
      return 'visual';
    }
    
    if (lowerPath.includes('a11y') || lowerPath.includes('accessibility')) {
      return 'accessibility';
    }
    
    if (lowerPath.includes('performance') || lowerPath.includes('load')) {
      return 'performance';
    }

    // Default to unit test if in test directory
    return 'unit';
  }

  /**
   * Analyze test file coverage
   */
  async _analyzeTestCoverage(testFile) {
    const content = fs.readFileSync(testFile, 'utf-8');
    
    // Count test cases
    const testCaseMatches = content.match(/it\(|test\(|describe\(/g) || [];
    const testCount = testCaseMatches.length;

    // Identify tested files/modules
    const importMatches = content.match(/from\s+['"]([^'"]+)['"]/g) || [];
    const requireMatches = content.match(/require\(['"]([^'"]+)['"]\)/g) || [];
    
    const testedModules = [
      ...importMatches.map(m => m.match(/['"]([^'"]+)['"]/)[1]),
      ...requireMatches.map(m => m.match(/['"]([^'"]+)['"]/)[1])
    ].filter(m => m.startsWith('.') || m.startsWith('@/') || m.startsWith('~/'));

    return {
      testCount,
      testedModules,
      hasAsyncTests: content.includes('async '),
      hasMocks: content.includes('jest.mock') || content.includes('sinon') || content.includes('stub'),
      framework: this._detectFramework(content)
    };
  }

  /**
   * Detect test framework from file content
   */
  _detectFramework(content) {
    if (content.includes('@playwright/test') || content.includes('playwright')) return 'playwright';
    if (content.includes('cypress')) return 'cypress';
    if (content.includes('jest') || content.includes('@jest/globals')) return 'jest';
    if (content.includes('mocha') || content.includes('chai')) return 'mocha';
    if (content.includes('vitest')) return 'vitest';
    // Detect Jest from its unique matcher style (toBe, toEqual, toHaveProperty, etc.)
    if (/expect\(.*\)\.(toBe|toEqual|toHaveProperty|toBeTruthy|toBeFalsy|toContain|toThrow|toHaveBeenCalled)\(/.test(content)) return 'jest';
    // describe + it + expect without any framework import is likely Jest (globals)
    if (content.includes('describe(') && content.includes('expect(') && content.includes('it(')) return 'jest';
    return 'unknown';
  }

  /**
   * Extract backend files from structure
   */
  _extractBackendFiles(structure) {
    if (!structure || !structure.files) return [];

    return structure.files
      .filter(file => {
        const isBackend = 
          file.path.includes('/api/') ||
          file.path.includes('/routes/') ||
          file.path.includes('/controllers/') ||
          file.path.includes('/services/') ||
          file.path.includes('/models/') ||
          file.path.includes('/handlers/') ||
          file.path.includes('/middleware/');
        
        const isSourceFile = 
          file.path.endsWith('.js') ||
          file.path.endsWith('.ts') ||
          file.path.endsWith('.py') ||
          file.path.endsWith('.go');

        return isBackend && isSourceFile && !this._isTestFile(file.path);
      })
      .map(file => ({
        path: file.path,
        type: this._detectFileType(file.path),
        size: file.size
      }));
  }

  /**
   * Detect file type (controller, service, model, etc.)
   */
  _detectFileType(filePath) {
    if (filePath.includes('controller')) return 'controller';
    if (filePath.includes('service')) return 'service';
    if (filePath.includes('model')) return 'model';
    if (filePath.includes('route')) return 'route';
    if (filePath.includes('middleware')) return 'middleware';
    if (filePath.includes('handler')) return 'handler';
    if (filePath.includes('api')) return 'api';
    return 'other';
  }

  /**
   * Check if file has test coverage
   */
  _hasTestCoverage(file, existingTests, testType) {
    const fileName = path.basename(file.path, path.extname(file.path));
    
    return existingTests.some(test => {
      // Check if test file name matches source file
      const testFileName = path.basename(test.file, path.extname(test.file));
      if (testFileName.includes(fileName) || fileName.includes(testFileName.replace(/\.test|\.spec/, ''))) {
        return true;
      }

      // Check if source file is imported in test
      if (test.testedModules) {
        return test.testedModules.some(module => module.includes(fileName));
      }

      return false;
    });
  }

  /**
   * Check if endpoint has test coverage
   */
  _hasEndpointCoverage(endpoint, existingApiTests) {
    const endpointPath = endpoint.path.toLowerCase();
    const method = endpoint.method.toLowerCase();

    return existingApiTests.some(test => {
      const content = test.testedModules ? test.testedModules.join(' ') : '';
      return content.toLowerCase().includes(endpointPath) && 
             content.toLowerCase().includes(method);
    });
  }

  /**
   * Check if route has E2E test coverage
   */
  _hasRouteCoverage(route, existingE2ETests) {
    const routePath = route.path.toLowerCase();

    return existingE2ETests.some(test => {
      return test.file.toLowerCase().includes(routePath.replace(/\//g, '-'));
    });
  }

  /**
   * Calculate priority for missing test
   */
  _calculatePriority(file) {
    // Higher priority for controllers, services, and API files
    if (file.type === 'controller' || file.type === 'service' || file.type === 'api') {
      return 'high';
    }
    if (file.type === 'model') {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Calculate priority for route
   */
  _calculateRoutePriority(route) {
    // Higher priority for authentication, payment, and user routes
    const highPriorityKeywords = ['auth', 'login', 'payment', 'checkout', 'user', 'admin'];
    const routePath = route.path.toLowerCase();

    if (highPriorityKeywords.some(keyword => routePath.includes(keyword))) {
      return 'high';
    }

    return 'medium';
  }
}

module.exports = TestCoverageScanner;
