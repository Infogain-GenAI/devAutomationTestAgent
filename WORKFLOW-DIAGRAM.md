# IGNIS Test Agent - Autonomous Workflow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ZERO HUMAN INTERACTION                               │
│                     GitHub Push → Complete PR with Fixes                     │
└─────────────────────────────────────────────────────────────────────────────┘

┌───────────────────── PHASE 1: SETUP (45 seconds) ─────────────────────────┐
│                                                                              │
│  🔀 GitHub Action Triggers                                                  │
│      └─→ Checkout Repository (branch: main)                                │
│                                                                              │
│  📦 Install Dependencies (automatic)                                        │
│      ├─→ Detect package manager (npm/yarn/pnpm)                            │
│      ├─→ npm ci                                                             │
│      └─→ npx playwright install --with-deps                                │
│                                                                              │
│  🔧 Environment Setup (automatic)                                           │
│      ├─→ Read existing .env files                                          │
│      ├─→ Auto-generate missing secrets                                     │
│      └─→ Create complete .env                                              │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────── PHASE 2: BACKEND VALIDATION (60 seconds) ─────────────────┐
│                                                                              │
│  🔍 Backend Endpoint Scanner (automatic)                                    │
│      ├─→ Scan all .js/.ts files in backend/                               │
│      ├─→ Extract endpoints: router.get(), @Get(), etc.                    │
│      └─→ Found: 47 endpoints                                               │
│                                                                              │
│  🤖 AI Security Analysis (automatic)                                        │
│      ├─→ Check SQL injection vulnerabilities                               │
│      ├─→ Check XSS vulnerabilities                                         │
│      ├─→ Validate authentication/authorization                             │
│      ├─→ Check input validation                                            │
│      └─→ Result: 7 issues (2 critical, 5 high)                            │
│                                                                              │
│  🛠️  Auto-Fix Critical Issues (automatic)                                   │
│      ├─→ AI generates fixes for 2 critical issues                          │
│      ├─→ Apply fixes to source code                                        │
│      ├─→ Validate fixes                                                    │
│      └─→ Commit: "fix: IGNIS backend validation fixes"                    │
└──────────────────────────────────────────────────────────────────────────────┘

┌───────────────── PHASE 3: APP STARTUP (15 seconds) ───────────────────────┐
│                                                                              │
│  🔎 Startup Method Detection (automatic)                                    │
│      ├─→ Check docker-compose.yml → Not found                             │
│      ├─→ Check package.json scripts                                        │
│      └─→ Found: "dev": "npm run dev" ✓                                    │
│                                                                              │
│  🎯 Port Detection (automatic)                                              │
│      ├─→ Check .env file: PORT=3000 ✓                                     │
│      └─→ Confirmed port: 3000                                              │
│                                                                              │
│  🚀 App Launch (automatic with retry)                                       │
│      ├─→ spawn("npm", ["run", "dev"])                                     │
│      ├─→ Wait for app readiness...                                         │
│      ├─→ Poll: http://localhost:3000 → 200 OK ✓                          │
│      └─→ App ready in 12 seconds                                           │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────── PHASE 4: TEST GENERATION (90 seconds) ────────────────────┐
│                                                                              │
│  📊 Code Analysis (automatic)                                               │
│      ├─→ Structure scan: 234 files analyzed                               │
│      ├─→ Extract routes, components, APIs                                  │
│      └─→ Build dependency graph                                            │
│                                                                              │
│  🤖 AI Test Generation (automatic)                                          │
│      ├─→ E2E Tests: 45 tests generated                                    │
│      │   └─→ generated-tests/e2e/user-flows.spec.js                       │
│      ├─→ API Tests: 67 tests generated                                    │
│      │   └─→ generated-tests/api/endpoints.spec.js                        │
│      ├─→ Visual Tests: 20 tests generated                                 │
│      ├─→ A11y Tests: 15 tests generated                                   │
│      └─→ Perf Tests: 9 tests generated                                    │
│                                                                              │
│  ⚙️  Playwright Config (auto-generated)                                     │
│      └─→ generated-tests/playwright.config.js                              │
│          ├─→ baseURL: http://localhost:3000                                │
│          ├─→ retries: 2                                                    │
│          ├─→ screenshots: on-failure                                       │
│          └─→ videos: on-failure                                            │
└──────────────────────────────────────────────────────────────────────────────┘

┌────────────────── PHASE 5: TEST EXECUTION (120 seconds) ──────────────────┐
│                                                                              │
│  🎭 Playwright Execution (automatic, parallel)                              │
│      Command: npx playwright test --reporter json                          │
│                                                                              │
│      Browser: Chromium (headless)                                          │
│      Workers: 4 (parallel execution)                                       │
│      Retries: 2 per test                                                   │
│                                                                              │
│      Running tests...                                                       │
│      ├─→ [1/156] e2e/user-login.spec.js:3 ✓ (2.3s)                       │
│      ├─→ [2/156] e2e/user-login.spec.js:15 ✓ (1.8s)                      │
│      ├─→ [3/156] api/users-api.spec.js:5 ✓ (0.5s)                        │
│      │   ... (parallel execution)                                          │
│      ├─→ [148/156] e2e/checkout.spec.js:45 ✓ (3.1s)                      │
│      ├─→ [149/156] e2e/payment.spec.js:12 ✗ (timeout)                    │
│      ├─→ [150/156] api/orders.spec.js:23 ✗ (500 error)                   │
│      │   ... (8 failures)                                                  │
│      └─→ [156/156] perf/load.spec.js:8 ✓ (5.2s)                          │
│                                                                              │
│  📊 Results (automatic parsing)                                             │
│      ✅ Passed: 148                                                         │
│      ❌ Failed: 8                                                           │
│      ⏭️  Skipped: 0                                                         │
│      ⏱️  Duration: 120 seconds                                              │
│                                                                              │
│  💾 Artifacts (automatic capture)                                           │
│      ├─→ test-results/results.json                                        │
│      ├─→ screenshots/ (8 failure screenshots)                             │
│      ├─→ videos/ (8 failure videos)                                       │
│      └─→ traces/ (8 trace files)                                          │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────── PHASE 6: AUTO-FIX ITERATIONS (270 seconds) ────────────────┐
│                                                                              │
│  🔄 ITERATION 1 (90 seconds)                                                │
│      🤖 AI Failure Analysis                                                 │
│         ├─→ Categorize: 3 frontend, 4 backend, 1 test                     │
│         └─→ Root cause: Missing waits, API errors                         │
│                                                                              │
│      🛠️  Generate & Apply Fixes                                             │
│         ├─→ Fix 1: Add waitForSelector() → Applied ✓                      │
│         ├─→ Fix 2: Fix API endpoint → Applied ✓                           │
│         ├─→ Fix 3: Update assertion → Applied ✓                           │
│         ├─→ Fix 4: Handle async properly → Applied ✓                      │
│         └─→ Fix 5: Add error handling → Applied ✓                         │
│                                                                              │
│      ✅ Validate Fixes (quick test run)                                     │
│         └─→ No regressions detected                                        │
│                                                                              │
│      📝 Commit Changes                                                      │
│         └─→ "fix: IGNIS iteration 1 — app + test fixes"                   │
│                                                                              │
│      🧪 Re-run Tests                                                        │
│         ✅ Passed: 153 (+5)                                                 │
│         ❌ Failed: 3 (-5)                                                   │
│                                                                              │
│  🔄 ITERATION 2 (90 seconds)                                                │
│      🤖 AI Failure Analysis                                                 │
│         └─→ Remaining issues: Race conditions, timing                      │
│                                                                              │
│      🛠️  Generate & Apply Fixes                                             │
│         ├─→ Fix 1: Add wait for navigation → Applied ✓                    │
│         └─→ Fix 2: Fix race condition → Applied ✓                         │
│                                                                              │
│      📝 Commit Changes                                                      │
│         └─→ "fix: IGNIS iteration 2 — app + test fixes"                   │
│                                                                              │
│      🧪 Re-run Tests                                                        │
│         ✅ Passed: 155 (+2)                                                 │
│         ❌ Failed: 1 (-2)                                                   │
│                                                                              │
│  🔄 ITERATION 3 (90 seconds)                                                │
│      🤖 AI Failure Analysis                                                 │
│         └─→ Last issue: Flaky selector                                     │
│                                                                              │
│      🛠️  Generate & Apply Fix                                               │
│         └─→ Fix: Use stable data-testid selector → Applied ✓              │
│                                                                              │
│      📝 Commit Changes                                                      │
│         └─→ "fix: IGNIS iteration 3 — test fix"                           │
│                                                                              │
│      🧪 Re-run Tests                                                        │
│         ✅ Passed: 156 (+1)                                                 │
│         ❌ Failed: 0 (-1)                                                   │
│         🎉 ALL TESTS PASSED!                                                │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────── PHASE 7: REPORTING & PR (15 seconds) ──────────────────────┐
│                                                                              │
│  📊 Generate Comprehensive Report (automatic)                               │
│      └─→ reports/analysis-report-2026-04-27T10-30-00.md                    │
│          ├─→ Executive Summary                                             │
│          ├─→ Backend Validation (7 issues, 2 fixed)                       │
│          ├─→ Test Results (156/156 passed)                                │
│          ├─→ Fixes Applied (8 total)                                      │
│          ├─→ Root Cause Analysis                                          │
│          └─→ Recommendations                                               │
│                                                                              │
│  📝 Commit Report                                                           │
│      └─→ "docs: IGNIS comprehensive analysis report"                       │
│                                                                              │
│  🔀 Create Pull Request (automatic)                                         │
│      ├─→ Branch: ignis/fix-a1b2c3d4                                       │
│      ├─→ Push branch to origin                                            │
│      ├─→ Create PR via GitHub API                                         │
│      └─→ PR: https://github.com/org/repo/pull/123                         │
│                                                                              │
│      PR Details:                                                            │
│      ├─ Title: "✅ IGNIS: All tests passing"                               │
│      ├─ Body: Full run summary with tables                                │
│      │        Backend validation results                                   │
│      │        Test results breakdown                                       │
│      │        Fixes applied list                                           │
│      │        Iteration history                                            │
│      │        Link to comprehensive report                                 │
│      └─ Labels: [ignis, automated-testing, ready-for-review]              │
└──────────────────────────────────────────────────────────────────────────────┘

┌────────────────── PHASE 8: CLEANUP (5 seconds) ───────────────────────────┐
│                                                                              │
│  🛑 Stop Application (automatic)                                            │
│      ├─→ Send SIGTERM to process (graceful)                               │
│      ├─→ Wait 5 seconds                                                    │
│      └─→ Send SIGKILL if needed (force)                                   │
│                                                                              │
│  🧹 Cleanup (automatic)                                                     │
│      ├─→ Release port 3000                                                │
│      ├─→ Remove temp files                                                │
│      └─→ Upload artifacts to GitHub                                       │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              COMPLETE!                                       │
│                                                                              │
│  Total Time: ~11 minutes                                                    │
│  Human Interaction: 0 seconds (ZERO!)                                       │
│                                                                              │
│  Results:                                                                    │
│  ✅ 47 backend endpoints validated                                          │
│  ✅ 7 security issues identified (2 critical fixed automatically)           │
│  ✅ 156 Playwright tests generated                                          │
│  ✅ 156/156 tests passing after 3 iterations                                │
│  ✅ 8 fixes applied automatically                                           │
│  ✅ Comprehensive report generated                                          │
│  ✅ Pull request created with all changes                                   │
│                                                                              │
│  Next: Human reviews PR and merges! (Only human touchpoint)                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        KEY: ZERO HUMAN INTERACTION                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  🤖 = AI-powered (Claude/OpenAI/Gemini)                                     │
│  ✓  = Automatic success                                                     │
│  ✗  = Automatic failure detection                                          │
│  🔄 = Automatic retry/iteration                                             │
│  📊 = Automatic data processing                                             │
│  🔀 = Automatic git operations                                              │
│  ❌ = No manual intervention points                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Playwright Test Example (Auto-Generated by AI)

```javascript
// generated-tests/e2e/user-login.spec.js
// This file was automatically generated by IGNIS Test Agent
// No manual test writing required!

const { test, expect } = require('@playwright/test');

test.describe('User Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should successfully login with valid credentials', async ({ page }) => {
    // Navigate to login
    await page.click('text=Login');
    await expect(page).toHaveURL('/login');
    
    // Fill form
    await page.fill('[data-testid="email"]', 'user@example.com');
    await page.fill('[data-testid="password"]', 'SecurePass123!');
    
    // Submit
    await page.click('button[type="submit"]');
    
    // Verify redirect
    await expect(page).toHaveURL('/dashboard');
    
    // Verify user is logged in
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
    await expect(page.locator('h1')).toContainText('Welcome');
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.fill('[data-testid="email"]', 'wrong@example.com');
    await page.fill('[data-testid="password"]', 'wrong');
    await page.click('button[type="submit"]');
    
    // Should stay on login page
    await expect(page).toHaveURL('/login');
    
    // Should show error message
    await expect(page.locator('.error-message')).toBeVisible();
    await expect(page.locator('.error-message')).toContainText('Invalid credentials');
  });

  test('should handle network errors gracefully', async ({ page }) => {
    // Intercept login request and simulate network error
    await page.route('**/api/auth/login', route => route.abort());
    
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'user@example.com');
    await page.fill('[data-testid="password"]', 'password');
    await page.click('button[type="submit"]');
    
    // Should show network error
    await expect(page.locator('.error-message')).toContainText('Network error');
  });
});
```

## Auto-Generated Playwright Config

```javascript
// generated-tests/playwright.config.js
// This file was automatically generated by IGNIS Test Agent

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: [
    './e2e/**/*.spec.js',
    './api/**/*.spec.js',
    './visual/**/*.spec.js',
    './accessibility/**/*.spec.js',
    './performance/**/*.spec.js'
  ],
  
  // No user configuration needed!
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  reporter: [
    ['json', { outputFile: '../test-results/results.json' }],
    ['html', { outputFolder: '../playwright-report', open: 'never' }],
    ['list']
  ],
  
  use: {
    baseURL: process.env.APP_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000
  },
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  
  timeout: 30000,
  expect: { timeout: 5000 }
});
```
