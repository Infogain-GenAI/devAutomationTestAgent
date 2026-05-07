'use strict';

const logger = require('../utils/logger');

/**
 * Factory for creating AI provider instances.
 * Providers are loaded lazily to avoid CJS/ESM compatibility issues
 * with SDK packages on Node 22+ (only the selected provider is loaded).
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
    case 'claude': {
      const ClaudeProvider = require('./claude-provider');
      return new ClaudeProvider(providerConfig);
    }
    case 'openai': {
      const OpenAIProvider = require('./openai-provider');
      return new OpenAIProvider(providerConfig);
    }
    case 'gemini': {
      const GeminiProvider = require('./gemini-provider');
      return new GeminiProvider(providerConfig);
    }
    default:
      throw new Error(`Unsupported AI provider: ${provider}. Choose one of: claude, openai, gemini`);
  }
}

module.exports = { createProvider };
