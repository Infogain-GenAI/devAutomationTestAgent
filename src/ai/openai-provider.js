'use strict';

const OpenAI = require('openai');
const BaseAIProvider = require('./base-provider');
const logger = require('../utils/logger');

class OpenAIProvider extends BaseAIProvider {
  constructor(config) {
    super(config);
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'gpt-4-turbo';
    this.maxTokens = 8192;
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
