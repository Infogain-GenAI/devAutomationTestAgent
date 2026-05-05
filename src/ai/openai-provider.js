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
        testInstructions += `Generate ${testType} tests for backend code using Jest/Mocha. Include:
- Unit tests for individual functions/methods
- Mock external dependencies
- Test edge cases and error handling
- Use describe/it/expect syntax
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

    const text = response.choices[0]?.message?.content || '';
    return this._parseJsonResponse(text);
  }

  _truncateContent(content, maxChars) {
    if (content.length <= maxChars) return content;
    logger.warn(`Truncating content from ${content.length} to ${maxChars} chars`);
    return content.slice(0, maxChars) + '\n... [truncated]';
  }
}

module.exports = OpenAIProvider;
