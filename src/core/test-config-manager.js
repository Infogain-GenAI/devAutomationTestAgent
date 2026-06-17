'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Test Configuration Manager
 * 
 * Manages separate configurations for unit tests and e2e/automation tests
 * Validates configuration availability before test execution
 * Creates default configurations from package.json if needed
 */
class TestConfigManager {
  constructor(config) {
    this.config = config;
    this.workDir = config.app?.workDir || process.cwd();
    this.configDir = path.join(this.workDir, 'config', 'test-configs');
    
    // Separate config files for different test types
    this.configs = {
      unit: path.join(this.configDir, 'unit-test.config.json'),
      e2e: path.join(this.configDir, 'e2e-test.config.json'),
      api: path.join(this.configDir, 'api-test.config.json'),
      automation: path.join(this.configDir, 'automation-test.config.json')
    };
  }

  /**
   * Ensure all test configurations exist
   * Creates them from package.json if not found
   */
  async ensureConfigurations() {
    logger.info('🔧 Test Configuration Manager — Initializing');
    logger.info('═'.repeat(70));

    // Ensure config directory exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
      logger.info(`✅ Created config directory: ${this.configDir}`);
    }

    // Read package.json for test info
    const packageJsonPath = path.join(this.workDir, 'package.json');
    let packageInfo = {};
    
    try {
      const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf-8');
      packageInfo = JSON.parse(packageJsonContent);
      logger.debug(`[TCM] Package.json loaded: v${packageInfo.version}`);
    } catch (err) {
      logger.warn(`[TCM] Failed to read package.json: ${err.message}`);
    }

    // Ensure each test type has a config
    const testTypes = ['unit', 'e2e', 'api', 'automation'];
    const results = {};

    for (const testType of testTypes) {
      results[testType] = await this._ensureTestConfig(testType, packageInfo);
    }

    logger.info('═'.repeat(70));
    logger.info('✅ All test configurations validated and ready\n');

    return results;
  }

  /**
   * Ensure a specific test type configuration exists
   * @private
   */
  async _ensureTestConfig(testType, packageInfo) {
    const configPath = this.configs[testType];
    let isNew = false;

    if (fs.existsSync(configPath)) {
      logger.info(`✅ Found existing ${testType} config: ${path.relative(this.workDir, configPath)}`);
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        return { path: configPath, isNew: false, config: JSON.parse(content) };
      } catch (err) {
        logger.warn(`[TCM] Error reading ${testType} config: ${err.message}, will recreate`);
        isNew = true;
      }
    } else {
      logger.info(`⚠️  No ${testType} config found, creating default...`);
      isNew = true;
    }

    if (isNew) {
      const defaultConfig = this._createDefaultConfig(testType, packageInfo);
      try {
        fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
        logger.info(`✅ Created default ${testType} config`);
        return { path: configPath, isNew: true, config: defaultConfig };
      } catch (err) {
        logger.error(`[TCM] Failed to write ${testType} config: ${err.message}`);
        throw err;
      }
    }
  }

  /**
   * Create default configuration for a test type
   * @private
   */
  _createDefaultConfig(testType, packageInfo) {
    const baseConfig = {
      name: `${testType} Test Configuration`,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      sourcePackageVersion: packageInfo.version || '2.0.0'
    };

    const testSpecificConfigs = {
      unit: {
        ...baseConfig,
        framework: 'jest',
        testCommand: 'jest tests/unit',
        outputDir: 'logs',
        coverage: {
          enabled: true,
          threshold: 80,
          types: ['statements', 'branches', 'functions', 'lines']
        },
        timeout: 30000,
        parallel: true,
        maxWorkers: 4,
        environment: 'node',
        globals: {
          testEnvironment: 'node'
        },
        reporter: ['default', 'json'],
        reporterOutput: {
          json: 'logs/unit-test-results.json',
          default: 'console'
        }
      },
      e2e: {
        ...baseConfig,
        framework: 'playwright',
        testCommand: 'npx playwright test',
        outputDir: 'logs',
        browsers: ['chromium', 'firefox', 'webkit'],
        headless: true,
        timeout: 30000,
        retries: 2,
        workers: 1,
        fullyParallel: false,
        webServer: {
          command: this._getAppStartCommand(),
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120000
        },
        reporter: [
          'html',
          'json',
          'junit'
        ],
        reporterOutput: {
          html: 'logs/e2e-report.html',
          json: 'logs/e2e-results.json',
          junit: 'logs/e2e-junit.xml'
        }
      },
      api: {
        ...baseConfig,
        framework: 'jest',
        testCommand: 'jest tests/api',
        outputDir: 'logs',
        coverage: {
          enabled: true,
          threshold: 75
        },
        timeout: 30000,
        parallel: true,
        apiBaseUrl: process.env.APP_URL || 'http://localhost:3000/api',
        retries: 2,
        reporter: ['default', 'json'],
        reporterOutput: {
          json: 'logs/api-test-results.json',
          default: 'console'
        }
      },
      automation: {
        ...baseConfig,
        framework: 'playwright',
        testCommand: 'npx playwright test --project=automation',
        outputDir: 'logs',
        browsers: ['chromium'],
        headless: true,
        timeout: 60000,
        retries: 3,
        workers: 1,
        fullyParallel: false,
        webServer: {
          command: this._getAppStartCommand(),
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 120000
        },
        reporter: [
          'html',
          'json',
          'junit'
        ],
        reporterOutput: {
          html: 'logs/automation-report.html',
          json: 'logs/automation-results.json',
          junit: 'logs/automation-junit.xml'
        }
      }
    };

    return testSpecificConfigs[testType] || baseConfig;
  }

  /**
   * Get app start command from package.json or env
   * @private
   */
  _getAppStartCommand() {
    return process.env.APP_START_COMMAND || 
           'npm start' || 
           'node src/index.js';
  }

  /**
   * Validate configuration for a specific test type before running
   */
  async validateTestConfig(testType) {
    const configPath = this.configs[testType];

    logger.info(`🔍 Validating ${testType} test configuration...`);

    if (!fs.existsSync(configPath)) {
      logger.error(`❌ Configuration not found: ${configPath}`);
      throw new Error(`No configuration available for ${testType} tests`);
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      // Basic validation
      if (!config.framework) {
        throw new Error('Missing framework in config');
      }
      if (!config.testCommand) {
        throw new Error('Missing testCommand in config');
      }

      logger.info(`✅ ${testType} configuration valid`);
      logger.info(`   Framework: ${config.framework}`);
      logger.info(`   Command: ${config.testCommand}`);
      logger.info(`   Timeout: ${config.timeout}ms`);

      return config;
    } catch (err) {
      logger.error(`❌ Configuration validation failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Get configuration for a test type
   */
  getConfig(testType) {
    const configPath = this.configs[testType];

    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration not found for ${testType} tests`);
    }

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to read ${testType} configuration: ${err.message}`);
    }
  }

  /**
   * Get all configurations
   */
  getAllConfigs() {
    const allConfigs = {};

    for (const [testType, configPath] of Object.entries(this.configs)) {
      try {
        allConfigs[testType] = this.getConfig(testType);
      } catch (err) {
        logger.warn(`[TCM] Could not load ${testType} config: ${err.message}`);
        allConfigs[testType] = null;
      }
    }

    return allConfigs;
  }

  /**
   * Update configuration for a test type
   */
  updateConfig(testType, updates) {
    try {
      const currentConfig = this.getConfig(testType);
      const updatedConfig = { ...currentConfig, ...updates, updatedAt: new Date().toISOString() };

      const configPath = this.configs[testType];
      fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

      logger.info(`✅ Updated ${testType} configuration`);
      return updatedConfig;
    } catch (err) {
      logger.error(`❌ Failed to update ${testType} config: ${err.message}`);
      throw err;
    }
  }

  /**
   * Print configuration summary for logging
   */
  printConfigurationSummary() {
    logger.info('\n📋 TEST CONFIGURATION SUMMARY:');
    logger.info('═'.repeat(70));

    const allConfigs = this.getAllConfigs();

    for (const [testType, config] of Object.entries(allConfigs)) {
      if (config) {
        logger.info(`\n🔹 ${testType.toUpperCase()}:`);
        logger.info(`   Framework: ${config.framework}`);
        logger.info(`   Command: ${config.testCommand}`);
        logger.info(`   Timeout: ${config.timeout}ms`);
        
        if (config.coverage) {
          logger.info(`   Coverage: Enabled (threshold: ${config.coverage.threshold}%)`);
        }
        
        if (config.parallel !== undefined) {
          logger.info(`   Parallel: ${config.parallel}`);
        }
        
        if (config.reporter) {
          logger.info(`   Reporters: ${config.reporter.join(', ')}`);
        }
      }
    }

    logger.info('\n' + '═'.repeat(70) + '\n');
  }
}

module.exports = TestConfigManager;
