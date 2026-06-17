# Playwright Headless Mode Command Prompt Guide

## Overview

All Playwright test cases are configured to run in **headless mode by default** when executed via command prompt. This document explains how to run tests locally and in CI/CD environments.

---

## 🎬 Quick Start Commands

### Run All E2E Tests (Headless) - Default
```bash
npm run test:e2e
```
✅ Runs all browsers in headless mode  
✅ Single worker (sequential execution)  
✅ Generates HTML, JSON, JUnit reports  
✅ Screenshots on failure  
✅ Auto-retries on failure (CI only)

### Run Only Chromium (Headless) - Fast
```bash
npm run test:e2e:chrome
```
✅ Fastest option for quick feedback  
✅ Suitable for CI/CD pipelines  
✅ Chromium only (most coverage)

### Run Automation Tests (Headless) - Dedicated
```bash
npm run test:automation
```
✅ Runs automation test suite only  
✅ Chromium browser only  
✅ 60-second timeout per test  
✅ Up to 3 retries on failure

### Headed Mode (Browser Visible) - Debugging
```bash
npm run test:e2e:headed
```
⚠️ Shows browser window  
⚠️ Useful for debugging test failures  
⚠️ Not suitable for CI/CD  
⚠️ Can only be run locally

### Debug Mode (Interactive)
```bash
npm run test:e2e:debug
```
🛠️ Opens Playwright Inspector  
🛠️ Step through tests interactively  
🛠️ Inspect DOM and console  
🛠️ For development only

---

## 🐳 Docker / CI Environment

In Docker containers and GitHub Actions, headless mode is automatically enabled:

```bash
# All these run in headless mode automatically in Docker
docker run -e PLAYWRIGHT_HEADLESS=1 -e CI=true ignis-test-agent:latest npm run test:e2e
docker run -e HEADLESS=true ignis-test-agent:latest npm run test:automation
```

**Set Environment Variables:**
```bash
export PLAYWRIGHT_HEADLESS=1    # Force headless
export HEADLESS=true             # Alternative flag
export CI=true                   # CI environment indicator
export HEADED=false              # Explicitly disable headed mode
```

---

## 📋 Command Reference

### E2E Test Commands

| Command | Mode | Browsers | Use Case |
|---------|------|----------|----------|
| `npm run test:e2e` | Headless | All (chromium, firefox, webkit) | Full E2E validation |
| `npm run test:e2e:chrome` | Headless | Chromium only | Quick CI validation |
| `npm run test:e2e:headed` | Headed | All | Local debugging |
| `npm run test:e2e:debug` | Debug | Chromium | Interactive troubleshooting |

### Automation Test Commands

| Command | Mode | Browsers | Use Case |
|---------|------|----------|----------|
| `npm run test:automation` | Headless | Chromium | Automation test suite |
| `npm run test:automation:headed` | Headed | Chromium | Debug automation tests |

### Setup Commands

| Command | Purpose |
|---------|---------|
| `npm run playwright:install` | Install all browsers (chromium, firefox, webkit) |
| `npm run setup` | Full setup + install Playwright chromium |

---

## 🔧 Headless Mode Configuration Details

### How It Works

The `playwright.config.js` file automatically determines the headless mode based on environment variables:

```javascript
// Priority order:
1. Command-line flags (--headed, --debug)
2. Environment variables (HEADED=1, PLAYWRIGHT_HEADLESS=1, HEADLESS=true)
3. CI environment detection (CI=true, GITHUB_ACTIONS=true)
4. Default: headless=true
```

### Environment Variables

```bash
# ✅ ENABLE HEADLESS (recommended for CI/production)
export PLAYWRIGHT_HEADLESS=1
export HEADLESS=true
export CI=true

# ❌ DISABLE HEADLESS (only for local debugging)
export HEADED=1
export HEADED=true
export DEBUG=true
```

### Configuration Override

**Force headless regardless of environment:**
```bash
PLAYWRIGHT_HEADLESS=1 npm run test:e2e
```

**Force headed mode for debugging:**
```bash
HEADED=1 npm run test:e2e
```

---

## 🌐 Local Development Workflow

### First-Time Setup
```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browsers
npm run playwright:install

# 3. Start your app (in another terminal)
npm start

# 4. Run tests in headless mode (recommended)
npm run test:e2e
```

### Running Tests Locally

**Headless (Recommended - See results in reports):**
```bash
npm run test:e2e
# Reports generated in:
# - playwright-report/index.html (open in browser)
# - logs/e2e-results.json (JSON data)
# - logs/e2e-junit.xml (JUnit format)
```

**Headed Mode (For Debugging):**
```bash
npm run test:e2e:headed
# Browser windows visible - watch tests run in real-time
```

**Interactive Debug Mode:**
```bash
npm run test:e2e:debug
# Playwright Inspector opens - step through tests
```

---

## 🐳 Docker / Container Execution

### In Docker Container
```bash
docker run -v $(pwd):/workspace ignis-test-agent:latest npm run test:e2e
# Automatically runs with:
# - PLAYWRIGHT_HEADLESS=1
# - CI=true
# - DISPLAY="" (no display)
# - Headless mode enforced
```

### In GitHub Actions Workflow
```yaml
- name: Run E2E Tests
  run: npm run test:e2e
  env:
    PLAYWRIGHT_HEADLESS: '1'
    CI: 'true'
    BASE_URL: 'http://localhost:3000'
```

---

## ⚙️ Advanced Configuration

### Custom Test Timeout
```bash
PLAYWRIGHT_TIMEOUT=60000 npm run test:e2e
```

### Custom Base URL
```bash
BASE_URL=http://myapp.com npm run test:e2e
```

### Test Single File
```bash
npx playwright test tests/integration/example.spec.js --headed
```

### Test with Output
```bash
# Verbose logging
npx playwright test --debug

# With traces
npx playwright test --trace on

# Generate report
npx playwright test --reporter=html
```

---

## 📊 Test Report Locations

After running tests, reports are generated at:

| Report Type | Location | Format | Open |
|-------------|----------|--------|------|
| **HTML Report** | `playwright-report/index.html` | Interactive HTML | `npx playwright show-report` |
| **JSON Results** | `logs/e2e-results.json` | Structured JSON | Any text editor |
| **JUnit XML** | `logs/e2e-junit.xml` | XML (CI/CD format) | XML viewer |

### View HTML Report
```bash
npx playwright show-report
# Opens interactive report in browser
```

---

## ✅ Verification Checklist

Before committing code:

```bash
# 1. Run unit tests
npm run test:unit

# 2. Run E2E tests in headless mode
npm run test:e2e:chrome

# 3. Run automation tests
npm run test:automation

# 4. Check coverage
npm test

# 5. Lint code
npm run lint
```

---

## 🔍 Troubleshooting

### Tests Won't Run in Headless Mode

**Problem:** Error about display or headless settings
```bash
# Solution: Explicitly set headless
export PLAYWRIGHT_HEADLESS=1
npm run test:e2e
```

### Browser Installation Issues
```bash
# Problem: Playwright browsers not installed
# Solution: Install specifically
npm run playwright:install
# OR
npx playwright install chromium firefox webkit
```

### Tests Hang in CI/Docker
```bash
# Problem: Tests appear frozen
# Solution: Set environment variables in Docker
docker run \
  -e PLAYWRIGHT_HEADLESS=1 \
  -e CI=true \
  -e DISPLAY="" \
  -e PLAYWRIGHT_BROWSERS_PATH="/ms-playwright" \
  ignis-test-agent:latest npm run test:e2e
```

### Timeout Issues
```bash
# Increase timeout for slow environments
PLAYWRIGHT_TIMEOUT=60000 npm run test:e2e
```

---

## 🎬 Production / CI/CD Best Practices

### GitHub Actions
```yaml
jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Install Playwright
        run: npm run playwright:install
      
      - name: Run E2E Tests (Headless)
        run: npm run test:e2e
        env:
          PLAYWRIGHT_HEADLESS: '1'
          CI: 'true'
      
      - name: Upload Reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-reports
          path: |
            playwright-report/
            logs/e2e-results.json
            logs/e2e-junit.xml
```

### Docker CI/CD
```bash
# In your CI/CD script
docker run \
  -v /path/to/repo:/workspace \
  -e PLAYWRIGHT_HEADLESS=1 \
  -e CI=true \
  -e NODE_ENV=production \
  ignis-test-agent:latest \
  npm run test:e2e

# Check exit code
echo "Exit code: $?"
```

---

## 📚 Additional Resources

- **Playwright Docs:** https://playwright.dev/docs/intro
- **Headless Mode:** https://playwright.dev/docs/api/class-browsertype#browser-type-launch
- **CI/CD Integration:** https://playwright.dev/docs/ci
- **Docker Guide:** https://playwright.dev/docs/docker

---

## Summary

✅ **Default:** All Playwright tests run in headless mode  
✅ **Command:** `npm run test:e2e` for headless execution  
✅ **CI/Docker:** Headless mode automatically enforced  
✅ **Debugging:** Use `npm run test:e2e:headed` locally only  
✅ **Reports:** Generated in `playwright-report/` and `logs/`

**Always use headless mode for CI/CD pipelines and production environments.**
