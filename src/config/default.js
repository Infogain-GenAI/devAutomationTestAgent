'use strict';

const path = require('path');

// Helper function to safely parse integers
const parseIntSafe = (value, defaultValue) => {
  const parsed = parseInt(value, 10);
  return !isNaN(parsed) ? parsed : defaultValue;
};

const defaults = {
  agent: {
    maxIterations: parseIntSafe(process.env.MAX_ITERATIONS, 3),
    subAgentMaxIterations: parseIntSafe(process.env.SUB_AGENT_MAX_ITERATIONS, 5),
    coverageThreshold: parseIntSafe(process.env.COVERAGE_THRESHOLD, 95),
    runMode: process.env.RUN_MODE || 'full', // full | generation | validation | execution
    timeoutMinutes: parseIntSafe(process.env.AGENT_TIMEOUT_MINUTES, 30),
    workDir: process.env.AGENT_WORK_DIR || path.join(process.cwd(), 'workspace'),
    branch: process.env.REPO_BRANCH || 'main',
    fixBranchPrefix: process.env.FIX_BRANCH_PREFIX || 'ignis/fix',
    analysisPromptFile: process.env.ANALYSIS_PROMPT_FILE || 'config/analysis-prompts.json',
    enableBackendValidation: process.env.ENABLE_BACKEND_VALIDATION === 'true',
    enableBestPracticesCheck: process.env.ENABLE_BEST_PRACTICES_CHECK !== 'false',
    enableEndpointValidation: process.env.ENABLE_ENDPOINT_VALIDATION !== 'false',
    generateAnalysisReport: process.env.GENERATE_ANALYSIS_REPORT !== 'false',
    skipPR: process.env.SKIP_PR === 'true',
    reportOutputDir: process.env.REPORT_OUTPUT_DIR || 'reports'
  },
  github: {
    authMethod: process.env.GITHUB_AUTH_METHOD || 'pat',
    token: process.env.GITHUB_PAT || process.env.GITHUB_TOKEN,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_PRIVATE_KEY,
    installationId: process.env.GITHUB_INSTALLATION_ID
  },
  ai: {
    provider: process.env.AI_PROVIDER || 'openai',
    codeGeneration: {
      useClaudeForCodeGen: !!(process.env.CODE_GENERATION_CLAUDE_API_KEY),
      claudeApiKey: process.env.CODE_GENERATION_CLAUDE_API_KEY || null,
      claudeModel: process.env.CODE_GENERATION_CLAUDE_MODEL || 'claude-sonnet-4-20250514'
    },
    claude: {
      apiKey: process.env.CLAUDE_API_KEY || process.env.AI_API_KEY,
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || process.env.AI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo'
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || process.env.AI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-1.5-pro'
    }
  },
  testing: {
    types: (process.env.TEST_TYPES || 'unit,integration,e2e,api').split(',').map(t => t.trim()),
    browsers: (process.env.BROWSERS || 'chromium').split(',').map(b => b.trim()),
    headless: process.env.HEADLESS !== 'false',
    // Unit test configuration
    unitTestFramework: process.env.UNIT_TEST_FRAMEWORK || 'auto', // auto, jest, mocha
    runUnitTests: process.env.RUN_UNIT_TESTS !== 'false'
  },
  app: {
    autoStart: process.env.AUTO_START_APP === 'true',
    startCommand: process.env.APP_START_COMMAND || null,
    url: process.env.APP_URL || null,
    port: process.env.APP_PORT ? parseIntSafe(process.env.APP_PORT, null) : null
  },
  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseIntSafe(process.env.POSTGRES_PORT, 5432),
    name: process.env.POSTGRES_DB || 'ignis_agent',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || ''
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs'
  }
};

module.exports = defaults;
