'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const BaseAIProvider = require('./base-provider');
const logger = require('../utils/logger');

class GeminiProvider extends BaseAIProvider {
  constructor(config) {
    super(config);
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'gemini-1.5-pro';
  }

  async analyzeCode(codeContext) {
    const systemPrompt = this._buildSystemPrompt(codeContext.phase);
    const userMessage = JSON.stringify(codeContext.context, null, 2);

    logger.info(`Gemini analyzing code (phase: ${codeContext.phase}, model: ${this.model})`);

    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt
    });

    const result = await model.generateContent(this._truncateContent(userMessage, 900000));
    const text = result.response.text();
    return this._parseJsonResponse(text);
  }

  async generateTests(analysisResult, testType, framework) {
    const systemPrompt = this._buildSystemPrompt('generate-tests');
    
    // Build context-aware instructions
    let instructions = '';
    const isChunked = !!analysisResult.chunkInfo;
    const isUnitTest = ['unit', 'integration'].includes(testType);
    
    if (isChunked) {
      instructions += `Generating tests for CHUNK: "${analysisResult.chunkInfo.name}" (${analysisResult.chunkInfo.totalScenarios} scenarios).\nGenerate ONLY tests for the scenarios provided. Be specific and comprehensive.\n\n`;
    }
    
    if (isUnitTest) {
      instructions += `Generate ${testType} tests using Jest. Include mocks, edge cases, error handling.\n`;
    } else if (isChunked && testType === 'e2e' && analysisResult.routes) {
      instructions += `Generate Playwright E2E tests for these routes:\n`;
      analysisResult.routes.forEach((r, i) => {
        instructions += `${i + 1}. ${typeof r === 'string' ? r : (r.path || r.route || JSON.stringify(r))}\n`;
      });
      instructions += `\nCover navigation, user interactions, assertions, and error states.\n`;
    } else if (isChunked && testType === 'api' && analysisResult.apiEndpoints) {
      instructions += `Generate Playwright API tests for these endpoints:\n`;
      analysisResult.apiEndpoints.forEach((ep, i) => {
        const method = typeof ep === 'string' ? 'GET' : (ep.method || 'GET');
        instructions += `${i + 1}. ${method} ${typeof ep === 'string' ? ep : (ep.path || ep.route || JSON.stringify(ep))}\n`;
      });
      instructions += `\nCover success responses, error responses, validation, and edge cases.\n`;
    } else {
      instructions += `Generate Playwright ${testType} tests based on the analysis.\n`;
    }
    
    instructions += `\nReturn a JSON object with:\n{\n  "files": [\n    { "path": "tests/${testType}/descriptive-name.spec.js", "content": "// full test file content" }\n  ]\n}`;

    const userMessage = JSON.stringify({
      testType,
      framework,
      analysis: analysisResult,
      instructions
    }, null, 2);

    logger.info(`Gemini generating ${testType} tests (model: ${this.model})`);

    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt
    });

    const result = await model.generateContent(this._truncateContent(userMessage, 900000));
    const text = result.response.text();
    return this._parseJsonResponse(text);
  }

  async analyzeFailures(testResults, sourceCode) {
    const systemPrompt = this._buildSystemPrompt('analyze-failures');
    const userMessage = JSON.stringify({ testResults, sourceCode }, null, 2);

    logger.info(`Gemini analyzing failures (model: ${this.model})`);

    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt
    });

    const result = await model.generateContent(this._truncateContent(userMessage, 900000));
    const text = result.response.text();
    return this._parseJsonResponse(text);
  }

  async generateFix(failureAnalysis, sourceCode) {
    const systemPrompt = this._buildSystemPrompt('generate-fix');
    const userMessage = JSON.stringify({ failureAnalysis, sourceCode }, null, 2);

    logger.info(`Gemini generating fixes (model: ${this.model})`);

    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt
    });

    const result = await model.generateContent(this._truncateContent(userMessage, 900000));
    const text = result.response.text();
    return this._parseJsonResponse(text);
  }

  _truncateContent(content, maxChars) {
    if (content.length <= maxChars) return content;
    logger.warn(`Truncating content from ${content.length} to ${maxChars} chars`);
    return content.slice(0, maxChars) + '\n... [truncated]';
  }
}

module.exports = GeminiProvider;
