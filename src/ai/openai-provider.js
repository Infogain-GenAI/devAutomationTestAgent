'use strict';

const OpenAI = require('openai');
const BaseAIProvider = require('./base-provider');
const logger = require('../utils/logger');

class OpenAIProvider extends BaseAIProvider {
  constructor(config) {
    super(config);
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'gpt-4-turbo';
    this.maxTokens = 4096; // GPT-4 Turbo max limit
  }

  async analyzeCode(codeContext) {
    const systemPrompt = this._buildSystemPrompt(codeContext.phase);
    const userMessage = JSON.stringify(codeContext.context, null, 2);

    logger.info(`OpenAI analyzing code (phase: ${codeContext.phase}, model: ${this.model})`);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this._truncateContent(userMessage, 120000) }
      ]
    });

    this._recordTokenUsage('analyzeCode', response.usage);
    const text = response.choices[0]?.message?.content || '';
    return this._parseJsonResponse(text);
  }

  async generateTests(analysisResult, testType, framework) {
    const systemPrompt = this._buildSystemPrompt('generate-tests');
    
    // Check if we're generating for gaps only
    const hasGaps = analysisResult.testGaps && analysisResult.testGaps.length > 0;
    const generateFor = analysisResult.generateFor || 'full-coverage';
    
    // Check if this is a chunked generation request
    const isChunked = !!analysisResult.chunkInfo;
    
    // Different instructions for unit vs E2E tests
    const isUnitTest = ['unit', 'integration'].includes(testType);
    
    let testInstructions = '';
    
    // Add chunk context if chunked generation
    if (isChunked) {
      testInstructions += `You are generating tests for CHUNK: "${analysisResult.chunkInfo.name}" (${analysisResult.chunkInfo.totalScenarios} scenarios).
This is part of a larger test suite being generated in batches. Generate ONLY tests for the scenarios provided below.
Do NOT generate placeholder or generic tests — be specific to the provided routes/endpoints.

`;
    }
    
    if (isUnitTest) {
      if (hasGaps && generateFor === 'gaps-only') {
        testInstructions += `Generate ${testType} tests ONLY for these missing test scenarios:

`;
        analysisResult.testGaps.forEach((gap, idx) => {
          testInstructions += `${idx + 1}. File: ${gap.file} (${gap.type})
   Priority: ${gap.priority}
   Reason: ${gap.reason}

`;
        });
        testInstructions += `
IMPORTANT: Generate tests ONLY for the files listed above. Do NOT create tests for files already covered.

`;
      } else {
        testInstructions += `Generate ${testType} tests for backend code using Jest. Include:
- Unit tests for individual functions/methods
- Mock external dependencies
- Test edge cases and error handling
- Use describe/it/expect syntax (Jest)
- MUST use CommonJS require() syntax (NOT ES module import/export)
- Use const request = require('supertest') for API/HTTP testing
- Use const app = require('relative/path/to/app') to import the Express app
- File names MUST end with .test.js (NOT .spec.js — those are for Playwright)
- DO NOT require or import 'jest', 'mocha', or 'jasmine' — they are test runners and provide globals automatically

COMPREHENSIVE TEST COVERAGE REQUIREMENTS:
- Generate tests for ALL possible scenarios including:
  * Happy path (normal successful operation)
  * Edge cases (empty inputs, max values, boundary conditions)
  * Error cases (invalid inputs, missing required fields, malformed data)
  * NFR scenarios (response time assertions, memory usage if applicable)
  * Security (unauthorized access, SQL injection attempts, XSS payloads)
  * Concurrency scenarios where applicable
  * Null/undefined handling
  * Type coercion edge cases
`;
      }
      testInstructions += `Return JSON with:
{
  "files": [
    { "path": "tests/${testType}/filename.test.js", "content": "// full test file" }
  ],
  "dependencies": ["jest", "@types/jest"] // or mocha equivalents
}`;
    } else {
      if (hasGaps && generateFor === 'gaps-only') {
        testInstructions += `Generate Playwright ${testType} tests ONLY for these missing scenarios:

`;
        analysisResult.testGaps.forEach((gap, idx) => {
          if (testType === 'api' && gap.endpoint) {
            testInstructions += `${idx + 1}. Endpoint: ${gap.endpoint}
   File: ${gap.file}
   Priority: ${gap.priority}

`;
          } else if (testType === 'e2e' && gap.route) {
            testInstructions += `${idx + 1}. Route: ${gap.route}
   File: ${gap.file}
   Priority: ${gap.priority}

`;
          }
        });
        testInstructions += `
IMPORTANT: Generate tests ONLY for the scenarios listed above. Do NOT create tests for already covered scenarios.

`;
      } else if (isChunked) {
        // Chunked generation with specific scenarios
        if (testType === 'e2e' && analysisResult.routes) {
          testInstructions += `Generate Playwright E2E tests for these specific routes/pages:

`;
          analysisResult.routes.forEach((route, idx) => {
            const routePath = typeof route === 'string' ? route : (route.path || route.route || JSON.stringify(route));
            testInstructions += `${idx + 1}. ${routePath}\n`;
          });
          testInstructions += `
Generate comprehensive E2E tests covering:
- Page navigation and rendering
- User interactions (clicks, forms, inputs)
- Assertions on visible content
- Error states and edge cases
Use unique and descriptive file names based on the route (e.g., "tests/e2e/dashboard.spec.js").

`;
        } else if (testType === 'api' && analysisResult.apiEndpoints) {
          testInstructions += `Generate Playwright API tests for these specific endpoints:

`;
          analysisResult.apiEndpoints.forEach((ep, idx) => {
            const method = typeof ep === 'string' ? 'GET' : (ep.method || 'GET');
            const epPath = typeof ep === 'string' ? ep : (ep.path || ep.route || JSON.stringify(ep));
            testInstructions += `${idx + 1}. ${method} ${epPath}\n`;
          });
          testInstructions += `
Generate comprehensive API tests covering:
- Success responses (status codes, response body structure)
- Error responses (400, 401, 404, 500)
- Request validation (missing/invalid params)
- Edge cases
Use unique and descriptive file names based on the resource (e.g., "tests/api/users-api.spec.js").

`;
        } else {
          testInstructions += `Generate Playwright ${testType} tests based on the analysis. `;
        }
      } else {
        testInstructions += `Generate Playwright ${testType} tests based on the analysis. `;
      }
      testInstructions += `Return JSON with:
{
  "files": [
    { "path": "tests/${testType}/test.spec.js", "content": "// full test file" }
  ]
}`;
    }

    // ── Add documentation-driven test instructions ──
    if (analysisResult.appDocumentation) {
      testInstructions += `

DOCUMENTATION-DRIVEN TEST GENERATION:
Use the following application documentation to generate comprehensive tests:
`;
      if (analysisResult.appDocumentation.edgeCases && analysisResult.appDocumentation.edgeCases.length > 0) {
        testInstructions += `
EDGE CASES TO TEST (MANDATORY — generate tests for ALL of these):
`;
        analysisResult.appDocumentation.edgeCases.forEach((ec, idx) => {
          testInstructions += `${idx + 1}. [${ec.category || 'General'}] ${ec.scenario} → Expected: ${ec.expectedBehavior || 'handle gracefully'}\n`;
        });
      }

      if (analysisResult.appDocumentation.nfrScenarios && analysisResult.appDocumentation.nfrScenarios.length > 0) {
        testInstructions += `
NON-FUNCTIONAL REQUIREMENTS (NFR) — generate tests for these:
`;
        analysisResult.appDocumentation.nfrScenarios.forEach((nfr, idx) => {
          testInstructions += `${idx + 1}. [${nfr.category}] ${nfr.scenario} (Metric: ${nfr.metric || 'N/A'})\n`;
        });
      }

      if (analysisResult.appDocumentation.securityConsiderations && analysisResult.appDocumentation.securityConsiderations.length > 0) {
        testInstructions += `
SECURITY TEST SCENARIOS — generate tests for these:
`;
        analysisResult.appDocumentation.securityConsiderations.forEach((sec, idx) => {
          const desc = typeof sec === 'string' ? sec : (sec.testCase || sec.vulnerability || JSON.stringify(sec));
          testInstructions += `${idx + 1}. ${desc}\n`;
        });
      }

      if (analysisResult.appDocumentation.errorScenarios && analysisResult.appDocumentation.errorScenarios.length > 0) {
        testInstructions += `
ERROR HANDLING SCENARIOS — generate tests for these:
`;
        analysisResult.appDocumentation.errorScenarios.forEach((err, idx) => {
          testInstructions += `${idx + 1}. ${err.scenario || err.name || 'Error'}: Expected → ${err.expectedBehavior || err.handling || 'graceful handling'}\n`;
        });
      }

      if (analysisResult.appDocumentation.businessRules && analysisResult.appDocumentation.businessRules.length > 0) {
        testInstructions += `
BUSINESS RULES TO VALIDATE — ensure tests cover these:
`;
        analysisResult.appDocumentation.businessRules.forEach((rule, idx) => {
          testInstructions += `${idx + 1}. ${rule.rule} (Context: ${rule.context || 'N/A'})\n`;
        });
      }
    }

    // ── Add existing test extension instructions ──
    if (analysisResult.existingTestContext) {
      testInstructions += `

⚠️ CRITICAL: EXISTING TESTS DETECTED — DO NOT REWRITE FROM SCRATCH!
There are ${analysisResult.existingTestContext.totalExistingTests} existing test file(s).
${analysisResult.existingTestContext.instruction}

Existing test files:
${analysisResult.existingTestContext.existingFiles.map(f => `- ${f}`).join('\n')}

When generating tests:
1. Use the SAME coding style, patterns, and conventions as existing tests
2. Use the SAME file naming convention
3. ONLY generate NEW test cases that don't already exist
4. Focus on: edge cases, boundary conditions, error handling, NFR scenarios
5. Add describe blocks for untested features/functions
6. Include negative test cases (invalid inputs, unauthorized access, etc.)
7. Include performance/timeout assertions where applicable
`;
    }
    
    const userMessage = JSON.stringify({
      testType,
      framework,
      analysis: analysisResult,
      instructions: testInstructions
    }, null, 2);

    logger.info(`OpenAI generating ${testType} tests (model: ${this.model})`);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this._truncateContent(userMessage, 120000) }
      ]
    });

    this._recordTokenUsage('generateTests', response.usage);
    const text = response.choices[0]?.message?.content || '';
    return this._parseJsonResponse(text);
  }

  async analyzeFailures(testResults, sourceCode) {
    const systemPrompt = this._buildSystemPrompt('analyze-failures');
    const userMessage = JSON.stringify({ testResults, sourceCode }, null, 2);

    logger.info(`OpenAI analyzing failures (model: ${this.model})`);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this._truncateContent(userMessage, 120000) }
      ]
    });

    this._recordTokenUsage('analyzeFailures', response.usage);
    const text = response.choices[0]?.message?.content || '';
    return this._parseJsonResponse(text);
  }

  async generateFix(failureAnalysis, sourceCode) {
    const systemPrompt = this._buildSystemPrompt('generate-fix');
    const userMessage = JSON.stringify({ failureAnalysis, sourceCode }, null, 2);

    logger.info(`OpenAI generating fixes (model: ${this.model})`);

    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: this._truncateContent(userMessage, 120000) }
      ]
    });

    this._recordTokenUsage('generateFix', response.usage);
    const text = response.choices[0]?.message?.content || '';
    return this._parseJsonResponse(text);
  }

  _truncateContent(content, maxChars) {
    if (content.length <= maxChars) return content;
    
    // Try to intelligently truncate JSON content by reducing source code values
    try {
      const parsed = JSON.parse(content);
      if (parsed.sourceCode && typeof parsed.sourceCode === 'object') {
        // Truncate individual source files to fit within budget
        const overhead = JSON.stringify({ ...parsed, sourceCode: {} }).length;
        const availableForSource = maxChars - overhead - 1000; // 1k buffer
        const files = Object.entries(parsed.sourceCode);
        const perFileLimit = Math.max(5000, Math.floor(availableForSource / Math.max(files.length, 1)));
        
        for (const [key, value] of files) {
          if (typeof value === 'string' && value.length > perFileLimit) {
            parsed.sourceCode[key] = value.slice(0, perFileLimit) + '\n// ... [truncated]';
          }
        }
        
        const reduced = JSON.stringify(parsed, null, 2);
        if (reduced.length <= maxChars) {
          logger.info(`Smart-truncated source code (${content.length} → ${reduced.length} chars)`);
          return reduced;
        }
      }
    } catch {
      // Not JSON or parse failed — fall through to simple truncation
    }

    logger.warn(`Truncating content from ${content.length} to ${maxChars} chars`);
    return content.slice(0, maxChars) + '\n... [truncated]';
  }
}

module.exports = OpenAIProvider;
