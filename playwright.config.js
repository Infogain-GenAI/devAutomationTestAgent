// @ts-check
/**
 * Playwright Configuration
 * 
 * Configures Playwright for both local development and CI/CD environments
 * Supports headless mode (default for CI) and headed mode for local debugging
 * 
 * Usage:
 *   - Local (headless):        npx playwright test
 *   - Local (headed):          HEADED=1 npx playwright test
 *   - Local (debug):           npx playwright test --debug
 *   - CI/Docker (headless):    npx playwright test (PLAYWRIGHT_HEADLESS=1 by default)
 *   - Specific project:        npx playwright test --project=chromium
 *   - Specific file:           npx playwright test tests/e2e/example.spec.js
 *   - With retries:            npx playwright test --retries=3
 */

const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

// ============================================================================
// ENVIRONMENT VARIABLE CONFIGURATION
// ============================================================================
const IS_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
const IS_HEADLESS = process.env.PLAYWRIGHT_HEADLESS === '1' || process.env.HEADLESS === 'true' || !process.env.HEADED;
const HEADED_MODE = process.env.HEADED === '1' || process.env.HEADED === 'true' || process.env.DEBUG === 'true';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const BASE_URL = process.env.BASE_URL || process.env.APP_URL || 'http://localhost:3000';
const TIMEOUT_MS = parseInt(process.env.PLAYWRIGHT_TIMEOUT || '30000', 10);
const RETRIES = IS_CI ? 2 : 0;
const WORKERS = IS_CI ? 1 : 4;

// ============================================================================
// HEADLESS MODE DETERMINATION
// ============================================================================
// Command-line takes precedence: --headed or --debug flags
// Then environment variables: PLAYWRIGHT_HEADLESS, HEADLESS, HEADED
// Default: headless=true (most common for automation)
const determineHeadlessMode = () => {
  if (HEADED_MODE) {
    console.log('🎬 HEADED MODE: Browser windows will be visible');
    return false;
  }
  console.log('🎬 HEADLESS MODE: Running without visible browser (CI/automation)');
  return true;
};

// ============================================================================
// PROJECT CONFIGURATION
// ============================================================================
module.exports = defineConfig({
  // ─────────────────────────────────────────────────────────────────────────
  // TEST DISCOVERY & EXECUTION
  // ─────────────────────────────────────────────────────────────────────────
  testDir: path.join(__dirname, 'tests/integration'),
  testMatch: '**/*.spec.js',
  
  // ─────────────────────────────────────────────────────────────────────────
  // TIMEOUT CONFIGURATION
  // ─────────────────────────────────────────────────────────────────────────
  timeout: TIMEOUT_MS,
  actionTimeout: TIMEOUT_MS,
  navigationTimeout: TIMEOUT_MS,
  expect: {
    timeout: TIMEOUT_MS,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // RETRIES & PARALLEL EXECUTION
  // ─────────────────────────────────────────────────────────────────────────
  retries: RETRIES,
  workers: WORKERS,
  fullyParallel: false,
  forbidOnly: IS_CI,

  // ─────────────────────────────────────────────────────────────────────────
  // OUTPUT & REPORTING
  // ─────────────────────────────────────────────────────────────────────────
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'logs/e2e-results.json' }],
    ['junit', { outputFile: 'logs/e2e-junit.xml' }],
    ['list'],
  ],

  // ─────────────────────────────────────────────────────────────────────────
  // WEBSERVER CONFIGURATION (Auto-start app)
  // ─────────────────────────────────────────────────────────────────────────
  webServer: IS_CI ? null : {
    command: 'npm start',
    url: BASE_URL,
    reuseExistingServer: !IS_CI,
    timeout: 120000,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GLOBAL CONFIGURATION
  // ─────────────────────────────────────────────────────────────────────────
  use: {
    baseURL: BASE_URL,
    trace: IS_CI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: IS_CI ? 'only-on-failure' : 'off',
    video: IS_CI ? 'retain-on-failure' : 'off',
  },

  // ─────────────────────────────────────────────────────────────────────────
  // BROWSER PROJECTS (with headless configuration)
  // ─────────────────────────────────────────────────────────────────────────
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: determineHeadlessMode(),
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        headless: determineHeadlessMode(),
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        headless: determineHeadlessMode(),
      },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // AUTOMATION PROJECT (Single browser, CI-optimized)
    // ═══════════════════════════════════════════════════════════════════════
    {
      name: 'automation',
      testMatch: '**/automation/**/*.spec.js',
      use: {
        ...devices['Desktop Chrome'],
        headless: determineHeadlessMode(),
      },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // MOBILE TESTING (Optional)
    // ═══════════════════════════════════════════════════════════════════════
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        headless: determineHeadlessMode(),
      },
    },
  ],
});

// ============================================================================
// STARTUP MESSAGE
// ============================================================================
console.log('');
console.log('════════════════════════════════════════════════════════════════════════');
console.log('🎭 PLAYWRIGHT CONFIGURATION LOADED');
console.log('════════════════════════════════════════════════════════════════════════');
console.log(`  🌐 Base URL:        ${BASE_URL}`);
console.log(`  ⏱️  Timeout:         ${TIMEOUT_MS}ms`);
console.log(`  🔄 Retries:         ${RETRIES}`);
console.log(`  👷 Workers:         ${WORKERS}`);
console.log(`  🎬 Headless Mode:   ${determineHeadlessMode()}`);
console.log(`  🔗 CI Environment:  ${IS_CI}`);
console.log('════════════════════════════════════════════════════════════════════════');
console.log('');
