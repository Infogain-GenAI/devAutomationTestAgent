'use strict';

/**
 * Abstract base class defining the AI provider interface.
 * All providers must implement these methods.
 */
class BaseAIProvider {
  constructor(config) {
    if (new.target === BaseAIProvider) {
      throw new Error('BaseAIProvider is abstract and cannot be instantiated directly');
    }
    this.config = config;
  }

  /**
   * Analyze codebase and return testing strategy.
   * @param {Object} codeContext - { phase, context }
   * @returns {Object} - Analysis result with testing strategy
   */
  async analyzeCode(codeContext) {
    throw new Error('analyzeCode() must be implemented by provider');
  }

  /**
   * Generate Playwright test code.
   * @param {Object} analysisResult - Output from analyzeCode
   * @param {string} testType - 'e2e', 'api', 'visual', 'accessibility', 'performance'
   * @param {Object} framework - Tech stack info
   * @returns {Object} - { files: [{ path, content }] }
   */
  async generateTests(analysisResult, testType, framework) {
    throw new Error('generateTests() must be implemented by provider');
  }

  /**
   * Analyze test failures and determine root cause.
   * @param {Object} testResults - Test run results with failures
   * @param {Object} sourceCode - Relevant source code context
   * @returns {Object} - Failure analysis with categories and suggested fixes
   */
  async analyzeFailures(testResults, sourceCode) {
    throw new Error('analyzeFailures() must be implemented by provider');
  }

  /**
   * Generate code fixes for identified issues.
   * @param {Object} failureAnalysis - Output from analyzeFailures
   * @param {Object} sourceCode - Current source code
   * @returns {Array} - [{ file, originalCode, fixedCode, explanation }]
   */
  async generateFix(failureAnalysis, sourceCode) {
    throw new Error('generateFix() must be implemented by provider');
  }

  /**
   * Build a system prompt for the given task type.
   */
  _buildSystemPrompt(taskType) {
    const prompts = {
      'surface': `You are an expert code analyst. Analyze the provided codebase structure and return a JSON object with:
- "criticalFiles": array of file paths that are most important for testing
- "appType": string describing the application type (e.g., "full-stack web app", "API service")
- "testingPriorities": array of strings describing what should be tested first
- "userFlows": array of critical user flows to test
- "technologyNotes": object with technology-specific best practice recommendations based on the detected tech stack

IMPORTANT: If a "techStack" field is present in the context, use it to guide your analysis. Apply best practices specific to the detected frameworks (e.g., Express middleware testing patterns, React component testing strategies, database transaction handling). Your recommendations should be tailored to the exact technology stack detected.

Return ONLY valid JSON, no markdown formatting.`,

      'deep-dive': `You are an expert software testing architect. Analyze the provided source code and return a JSON object with:
- "testingStrategy": object with keys for each test type (e2e, api, visual, accessibility, performance) containing arrays of test scenarios
- "criticalPaths": array of critical user paths to test
- "edgeCases": array of edge cases and error scenarios
- "authFlow": description of authentication flow if present
- "formValidation": array of forms and their validation rules
- "apiContracts": array of API endpoint contracts (method, path, expected request/response)
- "bestPractices": object with technology-specific testing guidelines

IMPORTANT: If a "techStack" field is present in the context, use it to guide your analysis:
- For Express/Node.js backends: focus on middleware chains, error handling, route validation, async error propagation
- For React frontends: focus on component lifecycle, state management, hooks testing, rendering edge cases
- For MongoDB: focus on schema validation, indexing, transaction handling
- For PostgreSQL: focus on migrations, connection pooling, query optimization
- Apply framework-specific testing patterns and best practices for the detected stack.

Return ONLY valid JSON, no markdown formatting.`,

      'generate-tests': `You are an expert Playwright test engineer. Generate comprehensive, production-ready Playwright test files.

CRITICAL SYNTAX RULES (Playwright-specific):
- MUST use: const { test, expect } = require('@playwright/test');
- MUST use test.describe() for grouping (NOT bare describe())
- MUST use test() for test cases (NOT it())
- NEVER use bare describe() or it() — those are Jest/Mocha, NOT Playwright
- For API tests, use: test('name', async ({ request }) => { ... })
- For E2E tests, use: test('name', async ({ page }) => { ... })
- Use CommonJS require() syntax, NOT ES module import/export

Additional rules:
- Use descriptive test names
- Use data-testid selectors where possible, fall back to role-based selectors
- Add proper waits (waitForSelector, waitForResponse, etc.)
- Include setup/teardown in test.beforeEach/test.afterEach
- Handle authentication flows properly
- Add meaningful assertions
- Group related tests in test.describe blocks
Return ONLY valid JavaScript/TypeScript code, no markdown.`,

      'analyze-failures': `You are an expert debugging engineer. Analyze the test failures and return a JSON object with:
- "failures": array of objects with:
  - "testName": name of the failing test
  - "category": "frontend" | "backend" | "test" | "environment"
  - "rootCause": description of the root cause
  - "suggestedFix": description of how to fix it
  - "fixType": "app-code" | "test-code" | "env-config"
  - "confidence": number 0-1
Return ONLY valid JSON, no markdown formatting.`,

      'generate-fix': `You are an expert software engineer. Generate code fixes for the identified issues.
Return a JSON array of fix objects:
[{
  "file": "path/to/file",
  "originalCode": "exact code to replace",
  "fixedCode": "the fixed code",
  "explanation": "why this fix resolves the issue"
}]
Rules:
- originalCode must be an EXACT match of current code (copy-paste precision)
- fixedCode must be syntactically valid
- Fixes should be minimal — change only what's needed
- Preserve code style and indentation
Return ONLY valid JSON, no markdown formatting.`
    };

    return prompts[taskType] || prompts['deep-dive'];
  }

  /**
   * Parse AI response as JSON, handling common issues.
   */
  _parseJsonResponse(text) {
    // Strip markdown code fences if present
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // Try to extract JSON from the response
      const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          throw new Error(`Failed to parse AI response as JSON: ${e.message}`);
        }
      }
      throw new Error(`AI response is not valid JSON: ${e.message}`);
    }
  }
}

module.exports = BaseAIProvider;
