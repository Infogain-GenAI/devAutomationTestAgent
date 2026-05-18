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

    // Token usage tracking
    this.tokenUsage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      calls: 0,
      breakdown: [] // { method, inputTokens, outputTokens, timestamp }
    };
  }

  /**
   * Record token usage from an API response.
   * @param {string} method - The method that made the call (e.g., 'generateTests')
   * @param {object} usage - { inputTokens, outputTokens }
   */
  _recordTokenUsage(method, usage) {
    if (!usage) return;
    const input = usage.inputTokens || usage.input_tokens || usage.prompt_tokens || 0;
    const output = usage.outputTokens || usage.output_tokens || usage.completion_tokens || 0;

    this.tokenUsage.totalInputTokens += input;
    this.tokenUsage.totalOutputTokens += output;
    this.tokenUsage.totalTokens += (input + output);
    this.tokenUsage.calls += 1;
    this.tokenUsage.breakdown.push({
      method,
      inputTokens: input,
      outputTokens: output,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Get aggregated token usage stats.
   * @returns {object} - { totalInputTokens, totalOutputTokens, totalTokens, calls, breakdown }
   */
  getTokenUsage() {
    return { ...this.tokenUsage };
  }

  /**
   * Reset token usage counters.
   */
  resetTokenUsage() {
    this.tokenUsage = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      calls: 0,
      breakdown: []
    };
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
- NEVER use import/export syntax — this is a CommonJS project

VALID ASSERTION PATTERNS (use ONLY these):
- expect(response.status()).toBe(200);
- const json = await response.json(); expect(json).toEqual({ key: 'value' });
- const json = await response.json(); expect(json).toMatchObject({ key: 'value' });
- expect(json).toHaveProperty('key', 'value');
- expect(Array.isArray(json.items)).toBe(true);
- expect(json.length).toBeGreaterThan(0);
- NEVER use toHaveJSON() — it does NOT exist in Playwright
- NEVER use toHaveBody() — it does NOT exist in Playwright
- NEVER use toHaveStatus() — it does NOT exist in Playwright
- For response body assertions, ALWAYS do: const body = await response.json(); then assert on body

HUMAN INTERACTION TAGGING:
- If a test requires real human interaction (CAPTCHA, OAuth popup, file upload dialog, 2FA, physical device), add this annotation:
  test('name', { tag: '@human-interaction' }, async ({ page }) => { test.skip(true, 'Requires human interaction'); });
- Pure API tests (using { request }) NEVER need human interaction tagging
- Tests using { page } that only read/navigate (no login, no CAPTCHA) do NOT need tagging

Additional rules:
- Use descriptive test names
- Use data-testid selectors where possible, fall back to role-based selectors
- Add proper waits (waitForSelector, waitForResponse, etc.)
- Include setup/teardown in test.beforeEach/test.afterEach
- Handle authentication flows properly
- Group related tests in test.describe blocks

COMPREHENSIVE TEST COVERAGE (MANDATORY):
- Generate tests for ALL possible scenarios per feature:
  * Happy path (normal successful operation)
  * Edge cases (empty inputs, max-length strings, special characters, boundary values)
  * Negative tests (invalid inputs, unauthorized access, missing required fields)
  * Error handling (server errors, timeouts, malformed responses)
  * NFR scenarios (response time < 500ms, proper status codes, proper content-type headers)
  * Security (XSS payloads in inputs, SQL injection attempts, unauthorized access attempts)
  * State transitions (create → read → update → delete lifecycle)
- If "appDocumentation" is provided in the analysis context, use it to generate MORE TARGETED tests
- If "existingTestContext" is provided, DO NOT duplicate those tests — only add NEW scenarios

Return ONLY valid JavaScript/TypeScript code, no markdown.`,

      'analyze-failures': `You are an expert debugging engineer. Analyze the test failures and return a JSON object with:
- "failures": array of objects with:
  - "testName": name of the failing test
  - "file": the test file path (e.g. "tests/e2e/dashboard.spec.js")
  - "category": "frontend" | "backend" | "test" | "environment"
  - "rootCause": specific description of the root cause (e.g. "selector .btn-submit not found on page", "API returns 500 instead of 200")
  - "suggestedFix": concrete fix instruction (e.g. "change selector to button[type=submit]", "add error handling for 500 response")
  - "fixType": "app-code" | "test-code" | "env-config"
  - "confidence": number 0-1
  - "originalCode": the exact failing line(s) of code if available
  - "fixedCode": the corrected code if possible
- "summary": brief summary of the common failure patterns
Focus on test-code fixes (wrong selectors, wrong URLs, wrong assertions, missing waits).
Return ONLY valid JSON, no markdown formatting.`,

      'generate-fix': `You are an expert software engineer. Generate code fixes for the identified issues.
Return a JSON object with a "fixes" array:
{
  "fixes": [
    {
      "file": "path/to/file (relative to project root, e.g. generated-tests/tests/e2e/example.spec.js)",
      "originalCode": "exact code to replace (copy-paste from the source)",
      "fixedCode": "the corrected code",
      "explanation": "why this fix resolves the issue"
    }
  ]
}
Rules:
- originalCode must be an EXACT match of current code (copy-paste precision)
- fixedCode must be syntactically valid
- Fixes should be minimal — change only what's needed
- Preserve code style and indentation
- For Playwright E2E tests: fix selectors, assertions, timeouts, and page navigation
- For API tests: fix request URLs, methods, expected status codes, and response assertions
- If a test expects specific UI elements that don't exist, fix the selectors or remove the assertion
- Always include the file path relative to the project root
Return ONLY valid JSON, no markdown formatting.`,

      'documentation-features': `You are a senior technical writer and software architect. Analyze the provided application source code and generate comprehensive FEATURE DOCUMENTATION.

Based on the source code, routes, components, models, and configuration files provided, generate:

1. **applicationOverview**: A 2-3 paragraph description of what this application does, its purpose, and architecture.

2. **features**: An array of feature objects, each with:
   - "name": Feature name (e.g., "User Authentication", "Product Catalog")
   - "description": What this feature does
   - "components": List of related files/components
   - "userStories": Array of user story descriptions
   - "acceptanceCriteria": Array of testable acceptance criteria
   - "dependencies": External services or integrations this feature depends on

3. **businessRules**: Array of business rules with:
   - "rule": Description of the business rule
   - "context": Where it applies
   - "validationNeeded": What validation should exist

4. **integrationPoints**: Array of external integrations with:
   - "name": Integration name (e.g., "Payment Gateway", "Email Service")
   - "type": "api" | "database" | "message-queue" | "third-party"
   - "details": How it's integrated

5. **userFlows**: Array of critical user flows with:
   - "name": Flow name
   - "steps": Array of step descriptions
   - "happyPath": Expected successful outcome
   - "errorPaths": Array of possible error scenarios

Return ONLY valid JSON. No markdown formatting.`,

      'documentation-api': `You are an expert API documentation engineer. Analyze the provided source code and generate comprehensive API DOCUMENTATION.

Generate:

1. **endpoints**: Array of API endpoint objects, each with:
   - "method": HTTP method (GET, POST, PUT, DELETE, PATCH)
   - "path": Full endpoint path
   - "description": What this endpoint does
   - "requestBody": Expected request body schema (if applicable)
   - "queryParams": Array of query parameter objects { name, type, required, description }
   - "pathParams": Array of path parameter objects { name, type, description }
   - "headers": Required headers
   - "responseSchema": Expected response body structure
   - "statusCodes": Array of { code, description, responseExample }
   - "authentication": "required" | "optional" | "none"
   - "rateLimit": Rate limiting info if detected
   - "validationRules": Input validation rules

2. **dataModels**: Array of data model objects with:
   - "name": Model name
   - "fields": Array of { name, type, required, constraints, description }
   - "relationships": Related models
   - "validations": Built-in validation rules

3. **authenticationFlow**: Object with:
   - "type": "jwt" | "session" | "oauth" | "api-key" | "none"
   - "loginEndpoint": Path to login
   - "tokenStorage": Where tokens are stored
   - "refreshMechanism": How tokens refresh
   - "protectedRoutes": List of protected route patterns

Return ONLY valid JSON. No markdown formatting.`,

      'documentation-edge-cases': `You are an expert QA architect specializing in edge cases, boundary conditions, and non-functional requirements. Analyze the application features and API endpoints to generate comprehensive test scenarios.

Generate:

1. **edgeCases**: Array of edge case objects with:
   - "category": "Input Validation" | "Boundary" | "Concurrency" | "State" | "Error Recovery" | "Data Integrity" | "API"
   - "scenario": Detailed test scenario description
   - "expectedBehavior": What should happen
   - "priority": "critical" | "high" | "medium" | "low"
   - "relatedFeature": Which feature this tests

2. **nfrScenarios**: Array of non-functional requirement test scenarios with:
   - "category": "Performance" | "Security" | "Reliability" | "Scalability" | "Usability" | "Compliance"
   - "scenario": Test scenario description
   - "metric": Measurable acceptance criteria
   - "testApproach": How to test this (e.g., "load test", "penetration test", "response time measurement")

3. **securityConsiderations**: Array of security test scenarios with:
   - "vulnerability": Type (SQL Injection, XSS, CSRF, Auth Bypass, etc.)
   - "target": Which endpoint/feature is vulnerable
   - "testCase": How to test for this vulnerability
   - "expectedDefense": Expected security control

4. **errorScenarios**: Array of error handling scenarios with:
   - "scenario": What goes wrong (database down, network timeout, invalid state, etc.)
   - "trigger": How to trigger this error
   - "expectedBehavior": How the app should respond
   - "userImpact": Impact on end users

Return ONLY valid JSON. No markdown formatting.`
    };

    return prompts[taskType] || prompts['deep-dive'];
  }

  /**
   * Parse AI response as JSON, handling common issues including truncated responses.
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
          // Fall through to truncated repair
        }
      }

      // Attempt to repair truncated JSON (common when max_tokens is hit)
      const repaired = this._repairTruncatedJson(cleaned);
      if (repaired !== null) {
        return repaired;
      }

      throw new Error(`Failed to parse AI response as JSON: ${e.message}`);
    }
  }

  /**
   * Attempt to repair truncated JSON by closing open strings, arrays, and objects.
   * Returns parsed object or null if repair fails.
   */
  _repairTruncatedJson(text) {
    try {
      let repaired = text;

      // If truncated mid-string, close the string
      let inString = false;
      let escaped = false;
      for (let i = 0; i < repaired.length; i++) {
        const ch = repaired[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; }
      }
      if (inString) {
        repaired += '"';
      }

      // Remove trailing comma if present (invalid before closing bracket)
      repaired = repaired.replace(/,\s*$/, '');

      // Count open braces/brackets and close them
      const opens = [];
      inString = false;
      escaped = false;
      for (let i = 0; i < repaired.length; i++) {
        const ch = repaired[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') opens.push('}');
        else if (ch === '[') opens.push(']');
        else if (ch === '}' || ch === ']') opens.pop();
      }

      // Close all unclosed brackets/braces
      while (opens.length > 0) {
        repaired += opens.pop();
      }

      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

module.exports = BaseAIProvider;
