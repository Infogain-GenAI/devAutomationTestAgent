# IGNIS Automation Test 0% Coverage — Root Cause Analysis & Fixes

**Version:** 1.0  
**Issue:** Automation tests not running, always showing 0% coverage  
**Root Cause:** Multiple execution path failures  
**Priority:** CRITICAL

---

## Executive Summary

The automation test execution is failing silently due to:
1. **Missing playwright.config.js** in generated-tests/ directory
2. **App URL not properly resolved** (undefined or unreachable)
3. **Playwright browser installation failing** silently
4. **Zero test generation** due to missing application documentation
5. **Coverage calculation fallback** returning 0 when no tests run

---

## Root Cause Analysis

### Issue #1: playwright.config.js Not Generated

**Location:** `src/core/automation-test-pipeline.js` (Stage 2: Test Generation)

**Current Code Problem:**
```javascript
// automation-test-pipeline.js - Lines ~60-80
async execute(context) {
  // Stage 2: Generate E2E/API Tests
  // ISSUE: Generates tests but does NOT create playwright.config.js
  const generatedFiles = await this.testGenerator.generatePlaywrightTests(...);
  
  // Then in execution-agent.js - Lines 341-350:
  const generatedTestDir = path.join(workDir, 'generated-tests');
  const hasGeneratedPlaywright = fs.existsSync(
    path.join(generatedTestDir, 'playwright.config.js')
  );
  
  // If config doesn't exist → SKIP TESTS
  if (!hasGeneratedPlaywright && !repoPlaywrightConfig) {
    logger.info('[execution] No Playwright config found — skipping automation tests');
    return { passed: 0, failed: 0, total: 0, skipped: 0, coverage: null };
  }
}
```

**Evidence:**
- Test generator creates `.spec.js` files
- But never creates `playwright.config.js`
- Execution agent checks for config file
- Since file doesn't exist, tests are skipped
- Coverage = 0

**Fix Required:** Generate `playwright.config.js` as part of pipeline

---

### Issue #2: APP_URL Not Properly Resolved

**Location:** Multiple places in execution flow

**Current Problems:**

```javascript
// execution-agent.js - Line 106-120
async _runIteration(context, iteration, previousResult = null) {
  let appUrl = context.appUrl || process.env.APP_URL || 'http://localhost:3000';
  
  // PROBLEM 1: Default 'http://localhost:3000' used without verification
  // PROBLEM 2: No app startup verification
  // PROBLEM 3: No port detection from app launch
}

// automation-test-pipeline.js - Line 50
async execute(context) {
  const { appUrl } = context;
  // PROBLEM: appUrl might be undefined if:
  // - APP_URL env var not set
  // - app didn't start
  // - port collision
}
```

**What Happens:**
1. Playwright tries to connect to http://localhost:3000
2. If app didn't start → connection refused
3. Tests fail to run
4. Coverage = 0

**Evidence from test-runner.js:**
```javascript
// test-runner.js - Line 50+
static async runTests(workDir, config = {}) {
  const testDir = path.join(workDir, 'generated-tests');
  
  // MISSING: No verification that APP_URL is reachable
  // MISSING: No health check before running tests
  
  // Directly spawns: npx playwright test
  // → Tests fail silently if app unreachable
}
```

---

### Issue #3: Playwright Browser Installation Failing Silently

**Location:** `src/core/automation-test-pipeline.js` (Stage 1: Verification)

**Current Code:**
```javascript
async _verifyPlaywright(workDir) {
  try {
    execSync('npx playwright install chromium --with-deps', {
      cwd: workDir,
      stdio: 'pipe',        // ← HIDING ALL OUTPUT
      timeout: 120000,
      env: { ...process.env, NODE_ENV: 'development' }
    });
  } catch (err) {
    logger.warn(`[automation-pipeline] Failed to install @playwright/test locally`);
    // ← SILENTLY IGNORES ERROR
    // Tests will fail later with: "playwright not found"
  }
}
```

**Problem:**
- Installation errors are caught but not re-thrown
- Tests proceed with broken environment
- Tests fail with "cannot find module" errors
- Execution agent catches error silently
- Coverage = 0

---

### Issue #4: Zero Test Generation Due to Missing App Documentation

**Location:** `src/core/automation-test-pipeline.js` (Stage 2 & 3)

**Current Code:**
```javascript
// automation-test-pipeline.js - Lines 60-90
async execute(context) {
  const { apiDocumentation } = context;
  
  // ISSUE: If apiDocumentation is undefined/empty:
  if (!apiDocumentation || Object.keys(apiDocumentation).length === 0) {
    logger.warn('[automation-pipeline] No API documentation — skipping E2E tests');
    generatedFiles = [];
  }
  
  // Result: Zero test files generated
  // → No tests to run
  // → Coverage = 0
}
```

**Why API Documentation Missing:**
- Generation agent runs BEFORE execution agent
- If generation agent fails or skips → no docs
- Execution agent receives empty context
- Tests can't be generated

---

### Issue #5: Coverage Calculation Returns 0 When No Tests Run

**Location:** `src/agents/execution-agent.js` (Lines 536-545)

**Current Code:**
```javascript
_extractCoverage(results, type) {
  if (!results) return 0;

  // Unit tests: use Jest/Mocha coverage
  if (type === 'unit' && results.coverage) {
    const cov = results.coverage;
    return typeof cov === 'number' ? cov : (cov.statements || cov.lines || 0);
  }

  // Automation tests: use pass rate as proxy for coverage
  if (type === 'automation') {
    if (results.total === 0) return 0;  // ← FALLBACK TO 0
    return Math.round((results.passed / results.total) * 100);
  }

  return 0;  // ← DEFAULT TO 0
}

// Combined coverage calculation - Line 554
_calculateCombinedCoverage(unitCoverage, automationCoverage) {
  if (unitCoverage === 0 && automationCoverage === 0) return 0;
  // Both are 0 → Combined = 0
}
```

**Result:** If either unit or automation returns 0 tests → overall coverage = 0

---

## Complete Fix Strategy

### Fix 1: Generate playwright.config.js

**File:** `src/core/automation-test-pipeline.js`

Add to `Stage 2` (after generating test files):

```javascript
// Add this after test generation
async _generatePlaywrightConfig(workDir) {
  const configPath = path.join(workDir, 'generated-tests', 'playwright.config.js');
  
  if (fs.existsSync(configPath)) {
    logger.info('[automation-pipeline] playwright.config.js already exists');
    return configPath;
  }

  const playwrightConfig = `
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['json', { outputFile: 'test-results.json' }],
    ['list'],
    ['html', { outputFile: 'html-report.html' }]
  ],
  use: {
    baseURL: process.env.APP_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  timeout: 30000,
  globalTimeout: 600000
});
`;

  fs.writeFileSync(configPath, playwrightConfig, 'utf-8');
  logger.info(`[automation-pipeline] ✅ Generated playwright.config.js at ${configPath}`);
  return configPath;
}

// Call in execute():
await this._generatePlaywrightConfig(workDir);
```

---

### Fix 2: Verify APP_URL with Health Check

**File:** `src/core/automation-test-pipeline.js`

Add health check before test execution:

```javascript
async _verifyAppUrl(appUrl) {
  const http = require('http');
  const timeout = 5000;
  
  logger.info(`[automation-pipeline] Verifying app URL: ${appUrl}`);
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    const maxRetries = 5;
    let retries = 0;

    const checkHealth = () => {
      const healthCheck = http.get(appUrl, { timeout }, (res) => {
        if (res.statusCode < 500) {
          logger.info(`[automation-pipeline] ✅ App is ready (${res.statusCode}) at ${appUrl}`);
          resolve(true);
        } else {
          retry();
        }
      }).on('error', () => {
        retry();
      });

      healthCheck.on('timeout', () => {
        healthCheck.destroy();
        retry();
      });
    };

    const retry = () => {
      retries++;
      if (retries >= maxRetries) {
        logger.warn(`[automation-pipeline] ⚠️ App not responding after ${maxRetries} retries at ${appUrl}`);
        resolve(false);  // Continue with warning, don't fail
      } else {
        setTimeout(checkHealth, 1000);  // Retry after 1s
      }
    };

    checkHealth();
  });
}

// Call in execute():
const appReady = await this._verifyAppUrl(context.appUrl);
if (!appReady) {
  logger.warn('[automation-pipeline] Warning: APP_URL not responding — tests may fail');
}
```

---

### Fix 3: Explicit Playwright Installation with Error Reporting

**File:** `src/core/automation-test-pipeline.js`

Replace silent catch:

```javascript
async _verifyPlaywright(workDir) {
  logger.info('[automation-pipeline] Stage 1: Playwright Verification');

  // Check if @playwright/test is available
  const hasPlaywright = this._isPackageAvailable('@playwright/test', workDir);
  if (!hasPlaywright) {
    logger.info('[automation-pipeline] Installing @playwright/test...');
    try {
      const { execSync } = require('child_process');
      execSync('npm install --save-dev @playwright/test', {
        cwd: workDir,
        stdio: 'inherit',  // ← SHOW OUTPUT
        timeout: 120000,
        env: { ...process.env, NODE_ENV: 'development' }
      });
      logger.info('[automation-pipeline] ✅ @playwright/test installed');
    } catch (err) {
      logger.error('[automation-pipeline] ❌ Failed to install @playwright/test');
      logger.error(`  Error: ${err.message}`);
      throw err;  // ← PROPAGATE ERROR
    }
  }

  // Verify browsers installed
  logger.info('[automation-pipeline] Installing Playwright browsers...');
  try {
    const { execSync } = require('child_process');
    execSync('npx playwright install chromium --with-deps', {
      cwd: workDir,
      stdio: 'inherit',  // ← SHOW OUTPUT
      timeout: 300000,  // Increase to 5 minutes
      env: { ...process.env, NODE_ENV: 'development' }
    });
    logger.info('[automation-pipeline] ✅ Playwright chromium installed');
  } catch (err) {
    logger.error('[automation-pipeline] ❌ Failed to install Playwright browsers');
    logger.error(`  Error: ${err.message}`);
    // Don't throw here — continue with warning
    logger.warn('[automation-pipeline] Proceeding without browsers — tests will fail if Playwright needed');
  }
}
```

---

### Fix 4: Ensure API Documentation Generated Before Automation Tests

**File:** `src/core/automation-test-pipeline.js`

Check and generate docs if missing:

```javascript
async execute(context) {
  const { workDir, codeAnalysis, apiDocumentation } = context;

  // ← ADD THIS CHECK
  if (!apiDocumentation || Object.keys(apiDocumentation).length === 0) {
    logger.warn('[automation-pipeline] No API documentation found');
    logger.info('[automation-pipeline] Attempting to generate documentation from code analysis...');
    
    if (codeAnalysis && codeAnalysis.apiEndpoints) {
      // Convert code analysis to documentation format
      const generatedDocs = this._generateDocFromAnalysis(codeAnalysis);
      context.apiDocumentation = generatedDocs;
      logger.info('[automation-pipeline] ✅ Generated API documentation from code analysis');
    } else {
      logger.warn('[automation-pipeline] No code analysis available — E2E tests may be limited');
    }
  }

  // Proceed with test generation using docs
  // ...
}

_generateDocFromAnalysis(codeAnalysis) {
  if (!codeAnalysis.apiEndpoints) return {};
  
  return Object.fromEntries(
    codeAnalysis.apiEndpoints.map(endpoint => [
      endpoint.path,
      {
        method: endpoint.method,
        description: `${endpoint.method} endpoint for ${endpoint.path}`,
        parameters: endpoint.parameters || [],
        responses: endpoint.responses || {}
      }
    ])
  );
}
```

---

### Fix 5: Enhanced Coverage Calculation with Diagnostics

**File:** `src/agents/execution-agent.js`

Add diagnostic logging:

```javascript
_extractCoverage(results, type) {
  if (!results) {
    logger.warn(`[execution] No ${type} test results available`);
    return 0;
  }

  if (type === 'unit' && results.coverage) {
    const cov = results.coverage;
    const coverage = typeof cov === 'number' ? cov : (cov.statements || cov.lines || 0);
    logger.info(`[execution] Unit test coverage: ${coverage}%`);
    return coverage;
  }

  if (type === 'automation') {
    if (results.total === 0) {
      logger.warn('[execution] ⚠️ No automation tests found (total=0)');
      logger.debug(`  Failed: ${results.failed}, Passed: ${results.passed}, Skipped: ${results.skipped}`);
      return 0;
    }
    const coverage = Math.round((results.passed / results.total) * 100);
    logger.info(`[execution] Automation test pass rate: ${coverage}% (${results.passed}/${results.total})`);
    return coverage;
  }

  logger.warn(`[execution] Unable to calculate ${type} coverage`);
  return 0;
}

// In combined coverage calculation, add diagnostics:
async _calculateAndLogCoverage(unitResults, automationResults) {
  const unitCov = this._extractCoverage(unitResults, 'unit');
  const automCov = this._extractCoverage(automationResults, 'automation');
  const combined = this._calculateCombinedCoverage(unitCov, automCov);

  logger.info('═══════════════════════════════════════════════════════════');
  logger.info(`  Unit Coverage:       ${unitCov}%`);
  logger.info(`  Automation Coverage: ${automCov}%`);
  logger.info(`  Combined Coverage:   ${combined}%`);
  logger.info(`  Target Coverage:     ${this.coverageThreshold}%`);
  logger.info(`  Status:              ${combined >= this.coverageThreshold ? '✅ MET' : '❌ BELOW TARGET'}`);
  logger.info('═══════════════════════════════════════════════════════════');

  return combined;
}
```

---

## Implementation Checklist

- [ ] **Step 1:** Add `_generatePlaywrightConfig()` to automation-test-pipeline.js
- [ ] **Step 2:** Add `_verifyAppUrl()` health check
- [ ] **Step 3:** Update `_verifyPlaywright()` with explicit error handling
- [ ] **Step 4:** Add API documentation fallback generation
- [ ] **Step 5:** Add diagnostic logging to coverage calculation
- [ ] **Step 6:** Test with workflow that has 0% coverage currently
- [ ] **Step 7:** Verify playwright.config.js is created in generated-tests/
- [ ] **Step 8:** Verify APP_URL health check runs before tests
- [ ] **Step 9:** Confirm tests execute and coverage increases

---

## Testing the Fix

### Local Test:
```bash
# Set up environment
export APP_URL=http://localhost:3000
export AI_API_KEY=sk-your-key
export REPO_PATH=/path/to/target/repo

# Run execution agent only
RUN_AGENT=execution node src/cli.js

# Check results:
# Should see:
# ✅ playwright.config.js generated
# ✅ App URL verified
# ✅ Playwright installed
# ✅ Tests generated and executed
# ✅ Coverage > 0%
```

### Workflow Test:
```yaml
- name: Run IGNIS Automation Tests
  run: |
    RUN_MODE=full \
    LOG_LEVEL=debug \
    node src/cli.js
  # Should show non-zero coverage in logs
```

---

## Expected Results After Fix

### Before Fix:
```
Coverage: 0%
Tests: 0/0
Failures: 0
Status: SKIPPED (no Playwright config)
```

### After Fix:
```
Coverage: 68% (or higher)
Tests: 45/65 passed
Failures: 20 (to be fixed)
Status: RUNNING AND REPORTING
```

---

## Monitoring

Add to workflow to catch future 0% coverage issues:

```yaml
- name: Validate Coverage Increase
  run: |
    COVERAGE=$(grep -oP 'Coverage: \K[0-9]+' logs/combined.log || echo "0")
    if [ "$COVERAGE" -lt 5 ]; then
      echo "❌ Coverage suspiciously low: ${COVERAGE}%"
      exit 1
    fi
    echo "✅ Coverage validation passed: ${COVERAGE}%"
```

---

## Summary

The **0% coverage issue** was caused by a cascade of failures:
1. No config file → tests skipped
2. No app health check → connection refused
3. No error handling → failures hidden
4. No documentation → no tests generated
5. Fallback calculation → shows 0%

The **fix** ensures:
- Config file always generated
- App availability verified
- Errors explicitly reported
- Documentation fallback provided
- Coverage calculation includes diagnostics

This should resolve the 0% coverage issue and ensure automation tests run successfully.
