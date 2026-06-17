# Playwright Headless Mode - Quick Reference

## 🚀 Run Tests (Headless - Default)

```bash
# All browsers (chromium, firefox, webkit)
npm run test:e2e

# Chromium only (fastest)
npm run test:e2e:chrome

# Automation tests
npm run test:automation
```

## 🔍 Debug Mode (Local Only)

```bash
# Browser visible
npm run test:e2e:headed

# Interactive debugging
npm run test:e2e:debug
```

## 📊 View Reports

```bash
# Open HTML report in browser
npx playwright show-report

# Reports are at:
# - playwright-report/index.html (interactive)
# - logs/e2e-results.json (JSON)
# - logs/e2e-junit.xml (JUnit)
```

## 🐳 Docker / CI

```bash
# Headless automatically enforced
docker run -e PLAYWRIGHT_HEADLESS=1 -e CI=true ignis-test-agent:latest npm run test:e2e

# GitHub Actions (already configured)
npm run test:e2e  # runs with PLAYWRIGHT_HEADLESS=1
```

## ⚙️ Configuration

**Force Headless:**
```bash
export PLAYWRIGHT_HEADLESS=1
npm run test:e2e
```

**Force Headed (local debugging only):**
```bash
export HEADED=1
npm run test:e2e
```

**Custom Timeout:**
```bash
export PLAYWRIGHT_TIMEOUT=60000
npm run test:e2e
```

**Custom Base URL:**
```bash
export BASE_URL=http://myapp.example.com
npm run test:e2e
```

## 📋 Available Commands

| Command | Headless | Use Case |
|---------|----------|----------|
| `npm run test:e2e` | ✅ | Full E2E testing |
| `npm run test:e2e:chrome` | ✅ | Fast CI validation |
| `npm run test:e2e:headed` | ❌ | Local debugging |
| `npm run test:e2e:debug` | ❌ | Interactive debugging |
| `npm run test:automation` | ✅ | Automation suite |
| `npm run test:automation:headed` | ❌ | Debug automation |
| `npm run playwright:install` | - | Install browsers |

## 🎯 Local Workflow

```bash
# 1. Install
npm install && npm run playwright:install

# 2. Start app (terminal 1)
npm start

# 3. Run tests headless (terminal 2)
npm run test:e2e

# 4. View results
npx playwright show-report
```

## ✅ Pre-commit Checklist

```bash
npm run test:unit              # Unit tests
npm run test:e2e:chrome        # E2E headless
npm run test:automation        # Automation headless
npm test                       # Full coverage
npm run lint                   # Code quality
```

## 📚 Full Documentation

- **Comprehensive Guide:** `PLAYWRIGHT-HEADLESS-MODE.md`
- **Setup Summary:** `PLAYWRIGHT-HEADLESS-SETUP.md`
- **Playwright Docs:** https://playwright.dev

## 🔑 Key Points

✅ **Headless by default** - All commands run headless  
✅ **Environment-aware** - CI/Docker auto-detect headless  
✅ **Local debugging** - Use `--headed` flag for development  
✅ **Reports included** - HTML, JSON, JUnit formats  
✅ **Fast feedback** - Chromium-only tests fastest  

---

**Your Playwright tests are now fully configured for headless mode automation!**
