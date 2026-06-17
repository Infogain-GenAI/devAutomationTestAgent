# Test Configuration Management System

## Overview

The Test Configuration Management System ensures that all test types (unit, e2e, API, automation) have properly validated configurations before execution. It automatically creates default configurations from `package.json` if they don't exist, and validates them before running tests.

## Why Configuration Management Matters

### Problems It Solves

1. **Missing Test Configs**: Tests fail silently when configuration files are missing
2. **Different Requirements**: Unit tests and E2E tests have completely different configurations
3. **Package.json Sync**: Test configs become stale when package.json changes
4. **First-time Setup**: New projects need proper test configurations to run
5. **CI/CD Reliability**: Configuration validation prevents test execution failures

## Architecture

### Directory Structure

```
project/
├── config/
│   └── test-configs/
│       ├── unit-test.config.json        # Jest unit test config
│       ├── e2e-test.config.json         # Playwright E2E config
│       ├── api-test.config.json         # Jest API test config
│       └── automation-test.config.json  # Playwright automation config
└── package.json
```

### Configuration Files

Each test type has a dedicated configuration file with test-specific settings:

#### Unit Test Config (`unit-test.config.json`)
```json
{
  "framework": "jest",
  "testCommand": "jest tests/unit",
  "coverage": {
    "enabled": true,
    "threshold": 80
  },
  "timeout": 30000,
  "parallel": true,
  "maxWorkers": 4
}
```

**Key Settings**:
- Framework: Jest for Node.js unit testing
- Coverage threshold: 80% minimum
- Parallel execution: Yes (up to 4 workers)
- Timeout: 30 seconds per test

#### E2E Test Config (`e2e-test.config.json`)
```json
{
  "framework": "playwright",
  "testCommand": "npx playwright test",
  "browsers": ["chromium", "firefox", "webkit"],
  "headless": true,
  "timeout": 30000,
  "retries": 2,
  "workers": 1,
  "webServer": {
    "command": "npm start",
    "url": "http://localhost:3000",
    "timeout": 120000
  }
}
```

**Key Settings**:
- Framework: Playwright for browser automation
- Multiple browsers: chromium, firefox, webkit
- Headless mode: Enabled for CI
- Single worker: Sequential test execution
- Auto web server: Starts app before tests

#### API Test Config (`api-test.config.json`)
```json
{
  "framework": "jest",
  "testCommand": "jest tests/api",
  "apiBaseUrl": "http://localhost:3000/api",
  "coverage": {
    "enabled": true,
    "threshold": 75
  },
  "timeout": 30000,
  "parallel": true,
  "retries": 2
}
```

**Key Settings**:
- Framework: Jest for API testing
- Base URL: API endpoint for requests
- Coverage threshold: 75% (slightly lower than unit tests)
- Parallel execution: Yes
- Retries: 2 (for flaky network tests)

#### Automation Test Config (`automation-test.config.json`)
```json
{
  "framework": "playwright",
  "testCommand": "npx playwright test --project=automation",
  "browsers": ["chromium"],
  "timeout": 60000,
  "retries": 3,
  "workers": 1,
  "webServer": {
    "command": "npm start",
    "timeout": 120000
  }
}
```

**Key Settings**:
- Framework: Playwright
- Single browser: Chromium only (faster)
- Extended timeout: 60 seconds (automation tests are slower)
- Higher retries: 3 (automation is more prone to flakiness)
- Single worker: Sequential execution

## Integration Points

### 1. Unit Test Pipeline (`src/core/unit-test-pipeline.js`)

**Stage 0: Validate Test Configurations**

```javascript
logger.info('[unit-pipeline] Stage 0: Validating Test Configurations');
await this.testConfigManager.ensureConfigurations();

// Validate unit test specific config
const unitConfig = await this.testConfigManager.validateTestConfig('unit');
logger.info('✅ Unit test configuration validated');
```

**Timing**: Runs before dependency verification
**Action**: 
- Creates missing configs from package.json
- Validates unit-test.config.json exists and is valid
- Prints configuration summary

### 2. Automation Test Pipeline (`src/core/automation-test-pipeline.js`)

**Stage 0.5: Validate Test Configurations**

```javascript
logger.info('[automation-pipeline] Stage 0.5: Validating Test Configurations');
await this.testConfigManager.ensureConfigurations();

// Validate E2E/automation test config
const e2eConfig = await this.testConfigManager.validateTestConfig('e2e');
logger.info('✅ E2E configuration validated');
```

**Timing**: Runs after app URL verification, before Playwright verification
**Action**:
- Creates missing E2E configs from package.json
- Validates e2e-test.config.json exists and is valid
- Prints configuration summary

### 3. Test Config Manager (`src/core/test-config-manager.js`)

**Main Methods**:

1. `ensureConfigurations()`
   - Creates config directory if missing
   - Validates/creates configs for all test types
   - Returns { unit, e2e, api, automation } status

2. `validateTestConfig(testType)`
   - Checks if config file exists
   - Validates JSON structure
   - Validates required fields (framework, testCommand)
   - Returns config object or throws error

3. `getConfig(testType)`
   - Returns parsed configuration object
   - Throws error if config not found

4. `updateConfig(testType, updates)`
   - Updates specific configuration with new values
   - Adds updatedAt timestamp
   - Persists to disk

5. `printConfigurationSummary()`
   - Logs all test configurations
   - Shows framework, command, timeout for each
   - Useful for debugging

## Usage in Tests

### Before Running Unit Tests

```javascript
const TestConfigManager = require('./test-config-manager');
const configManager = new TestConfigManager(config);

// Stage 1: Ensure configs exist
await configManager.ensureConfigurations();

// Stage 2: Validate unit test config
const unitConfig = configManager.validateTestConfig('unit');

// Stage 3: Use config to run tests
console.log('Running:', unitConfig.testCommand);
execSync(unitConfig.testCommand, { cwd: workDir });
```

### Before Running E2E Tests

```javascript
// Stage 1: Ensure configs exist
await configManager.ensureConfigurations();

// Stage 2: Validate E2E config
const e2eConfig = configManager.validateTestConfig('e2e');

// Stage 3: Start web server from config
const server = spawn(e2eConfig.webServer.command, {
  cwd: workDir,
  shell: true
});

// Stage 4: Wait for server, then run tests
await waitForServer(e2eConfig.webServer.url);
execSync(e2eConfig.testCommand, { cwd: workDir });
```

## Default Configuration Generation

When a configuration file doesn't exist, `TestConfigManager` automatically creates it from:

1. **package.json**: Reads version, scripts, dependencies
2. **Environment Variables**: 
   - `APP_START_COMMAND`: Custom app start command
   - `APP_URL`: Application URL
   - `CI`: Detects CI environment

3. **Test Type Specific Defaults**:

| Test Type | Framework | Default Command | Timeout | Parallel |
|-----------|-----------|-----------------|---------|----------|
| **unit** | Jest | jest tests/unit | 30s | Yes (4 workers) |
| **e2e** | Playwright | npx playwright test | 30s | No (1 worker) |
| **api** | Jest | jest tests/api | 30s | Yes |
| **automation** | Playwright | npx playwright test --project=automation | 60s | No (1 worker) |

## Configuration Differences: Unit vs E2E

### Unit Tests Configuration

```json
{
  "framework": "jest",
  "parallel": true,
  "maxWorkers": 4,
  "timeout": 30000,
  "coverage": { "threshold": 80 },
  "environment": "node"
}
```

**Why Different**:
- No browser needed → can run in parallel
- Fast execution → lower timeout
- High coverage expectations
- Node environment (no DOM)

### E2E Tests Configuration

```json
{
  "framework": "playwright",
  "parallel": false,
  "workers": 1,
  "timeout": 30000,
  "webServer": { "command": "npm start" },
  "browsers": ["chromium", "firefox", "webkit"]
}
```

**Why Different**:
- Browser required → cannot parallelize safely
- Slower execution → longer timeout
- Multiple browser testing
- Needs running web server

## Validation Flow

```
┌─────────────────────────────────┐
│ Test Pipeline Starts (Unit/E2E) │
└─────────────┬───────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│ Stage 0: Validate Configurations │
└─────────────┬────────────────────┘
              │
              ├─► Create config dir (if missing)
              │
              ├─► Check unit-test.config.json exists
              │   └─► Create default if missing
              │
              ├─► Check e2e-test.config.json exists
              │   └─► Create default if missing
              │
              ├─► Check api-test.config.json exists
              │   └─► Create default if missing
              │
              ├─► Check automation-test.config.json exists
              │   └─► Create default if missing
              │
              ├─► Validate required fields
              │   ├─► framework
              │   ├─► testCommand
              │   └─► (test type specific)
              │
              └─► Print summary
                  ├─► Unit: jest, jest tests/unit, 80% coverage
                  ├─► E2E: playwright, npx playwright test, chromium,firefox,webkit
                  ├─► API: jest, jest tests/api, 75% coverage
                  └─► Automation: playwright, npx playwright test, chromium
                  
              ▼
┌─────────────────────────────────┐
│ Proceed with Test Execution     │
│ (All configs validated & ready) │
└─────────────────────────────────┘
```

## CLI Usage

### Ensure All Configurations Exist

```bash
npm run validate
```

This runs the preflight check which validates all test configurations.

### View Configuration Summary

```bash
node -e "
  const TestConfigManager = require('./src/core/test-config-manager');
  const cm = new TestConfigManager({ app: { workDir: process.cwd() } });
  cm.printConfigurationSummary();
"
```

## Troubleshooting

### Issue: "Configuration not found for unit tests"

**Cause**: Config file missing or corrupted
**Solution**: 
```bash
# Delete and recreate config
rm config/test-configs/unit-test.config.json
npm run test:unit
```

### Issue: "E2E tests timeout"

**Cause**: Timeout too short for slow app startup
**Solution**: 
```json
// In e2e-test.config.json
{
  "webServer": {
    "timeout": 180000  // Increase to 3 minutes
  },
  "timeout": 60000  // Increase test timeout
}
```

### Issue: "Configuration validation failed"

**Cause**: Config JSON is invalid
**Solution**:
```bash
# Validate JSON syntax
node -e "console.log(JSON.parse(require('fs').readFileSync('config/test-configs/unit-test.config.json', 'utf-8')))"
```

## Best Practices

1. **Version Control**: Commit config files to git
   ```bash
   git add config/test-configs/
   git commit -m "Add test configurations"
   ```

2. **Customize Per Project**: Update timeouts, coverage thresholds based on needs
   ```json
   {
     "timeout": 45000,
     "coverage": { "threshold": 85 }
   }
   ```

3. **Monitor Config Changes**: Watch for config updates when package.json changes
   ```bash
   npm run validate
   ```

4. **Different Environments**: Override configs for CI vs local
   ```javascript
   if (process.env.CI) {
     config.timeout = 60000;
     config.retries = 3;
   }
   ```

## Files & Locations

| File | Purpose | Created By |
|------|---------|-----------|
| `config/test-configs/unit-test.config.json` | Jest unit test configuration | TestConfigManager or manual |
| `config/test-configs/e2e-test.config.json` | Playwright E2E configuration | TestConfigManager or manual |
| `config/test-configs/api-test.config.json` | Jest API test configuration | TestConfigManager or manual |
| `config/test-configs/automation-test.config.json` | Playwright automation config | TestConfigManager or manual |
| `src/core/test-config-manager.js` | Configuration manager class | Dev |
| `src/core/unit-test-pipeline.js` | Unit test pipeline (uses config) | Dev |
| `src/core/automation-test-pipeline.js` | E2E/automation pipeline (uses config) | Dev |

## Success Criteria

✅ Configuration files created automatically before tests run
✅ Different configs for unit vs E2E tests
✅ Validation prevents test execution with invalid configs
✅ Package.json used for configuration generation
✅ Summary printed to logs before test execution
✅ Configs persist between runs
✅ Easy to customize per project/environment
