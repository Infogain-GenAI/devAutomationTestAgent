'use strict';

const ClaudeProvider = require('./claude-provider');
const OpenAIProvider = require('./openai-provider');
const GeminiProvider = require('./gemini-provider');
const logger = require('../utils/logger');

/**
 * Factory for creating AI provider instances.
 */
function createProvider(config) {
  const provider = config.ai.provider;
  const providerConfig = config.ai[provider];

  if (!providerConfig || !providerConfig.apiKey) {
    throw new Error(
      `API key required for AI provider "${provider}". ` +
      `Set ${provider.toUpperCase()}_API_KEY or AI_API_KEY environment variable.`
    );
  }

  logger.info(`Creating AI provider: ${provider} (model: ${providerConfig.model})`);

  switch (provider) {
    case 'claude':
      return new ClaudeProvider(providerConfig);
    case 'openai':
      return new OpenAIProvider(providerConfig);
    case 'gemini':
      return new GeminiProvider(providerConfig);
    default:
      throw new Error(`Unsupported AI provider: ${provider}. Choose one of: claude, openai, gemini`);
  }
}

module.exports = { createProvider };
