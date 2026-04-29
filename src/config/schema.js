'use strict';

const Joi = require('joi');

const configSchema = Joi.object({
  agent: Joi.object({
    maxIterations: Joi.number().integer().min(1).max(10).default(3),
    timeoutMinutes: Joi.number().integer().min(5).max(120).default(30),
    workDir: Joi.string().default('./workspace'),
    branch: Joi.string().default('main')
  }).default(),

  github: Joi.object({
    authMethod: Joi.string().valid('pat', 'app').default('pat'),
    token: Joi.string().when('authMethod', {
      is: 'pat',
      then: Joi.string().required(),
      otherwise: Joi.string().allow(null, '')
    }),
    appId: Joi.string().when('authMethod', {
      is: 'app',
      then: Joi.string().required(),
      otherwise: Joi.string().allow(null, '')
    }),
    privateKey: Joi.string().when('authMethod', {
      is: 'app',
      then: Joi.string().required(),
      otherwise: Joi.string().allow(null, '')
    }),
    installationId: Joi.string().when('authMethod', {
      is: 'app',
      then: Joi.string().required(),
      otherwise: Joi.string().allow(null, '')
    })
  }).default(),

  ai: Joi.object({
    provider: Joi.string().valid('claude', 'openai', 'gemini').default('claude'),
    claude: Joi.object({
      apiKey: Joi.string().allow(null, ''),
      model: Joi.string().default('claude-sonnet-4-20250514')
    }).default(),
    openai: Joi.object({
      apiKey: Joi.string().allow(null, ''),
      model: Joi.string().default('gpt-4-turbo')
    }).default(),
    gemini: Joi.object({
      apiKey: Joi.string().allow(null, ''),
      model: Joi.string().default('gemini-1.5-pro')
    }).default()
  }).default(),

  testing: Joi.object({
    types: Joi.array().items(
      Joi.string().valid('e2e', 'api', 'visual', 'accessibility', 'performance')
    ).default(['e2e', 'api', 'visual', 'accessibility', 'performance']),
    browsers: Joi.array().items(
      Joi.string().valid('chromium', 'firefox', 'webkit')
    ).default(['chromium']),
    headless: Joi.boolean().default(true)
  }).default(),

  app: Joi.object({
    autoStart: Joi.boolean().default(false),
    startCommand: Joi.string().allow(null, '').default(null),
    url: Joi.string().uri({ scheme: ['http', 'https'] }).allow(null, '').default(null),
    port: Joi.number().integer().min(1).max(65535).allow(null).default(null)
  }).default(),

  database: Joi.object({
    host: Joi.string().default('localhost'),
    port: Joi.number().integer().default(5432),
    name: Joi.string().default('ignis_agent'),
    user: Joi.string().default('postgres'),
    password: Joi.string().allow('').default('')
  }).default(),

  logging: Joi.object({
    level: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
    dir: Joi.string().default('logs')
  }).default()
}).default();

/**
 * Validate and return a sanitized config object.
 * Throws if required fields are missing.
 */
function validateConfig(config) {
  const { error, value } = configSchema.validate(config, {
    abortEarly: false,
    stripUnknown: true
  });

  if (error) {
    const messages = error.details.map(d => d.message).join('; ');
    throw new Error(`Configuration validation failed: ${messages}`);
  }

  // Ensure the selected AI provider has an API key
  const provider = value.ai.provider;
  const providerConfig = value.ai[provider];
  if (!providerConfig || !providerConfig.apiKey) {
    throw new Error(`API key required for AI provider "${provider}". Set ${provider.toUpperCase()}_API_KEY or AI_API_KEY environment variable.`);
  }

  return value;
}

module.exports = { configSchema, validateConfig };
