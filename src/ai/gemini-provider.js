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
    const userMessage = JSON.stringify({
      testType,
      framework,
      analysis: analysisResult,
      instructions: `Generate Playwright ${testType} tests based on the analysis. Return a JSON object with:
{
  "files": [
    { "path": "relative/path/to/test.spec.js", "content": "// full test file content" }
  ]
}`
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
