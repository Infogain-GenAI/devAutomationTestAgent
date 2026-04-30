# Local Testing Guide - IGNIS Automation Test Agent

**Quick Start:** Get the IGNIS agent running locally in 5 minutes

---

## 🚀 Quick Start (5 Minutes)

### Step 1: Install Dependencies

```powershell
# Navigate to IGNIS agent directory
cd "D:\Official\Assignments\PROJECTS\IGNIS\After Format\dev-Automation-test-Agent\devAutomationTestAgent"

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install --with-deps chromium
```

### Step 2: Configure Environment

```powershell
# Copy example configuration
cp .env.example .env

# Edit .env with your favorite editor
notepad .env
```

**Minimum configuration required:**

```bash
# Required: Get from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-proj-your-key-here

# Required: Get from https://github.com/settings/tokens
GITHUB_TOKEN=ghp-your-token-here

# Recommended: Point to your project
REPO_PATH=D:/path/to/your/project
```

### Step 3: Run the Agent

```powershell
# Test on current directory
npm run cli

# Or specify a project path
$env:REPO_PATH="D:\path\to\your\project"
npm run cli
```

That's it! The agent will analyze your project and generate tests.

---

## 📋 Testing Scenarios

### Scenario 1: Test on a Sample Node.js Project

```powershell
# 1. Create a simple Express app for testing
mkdir test-project
cd test-project
npm init -y
npm install express

# 2. Create simple server
@"
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/api/users', (req, res) => {
  res.json([{ id: 1, name: 'John' }]);
});

app.listen(3000, () => console.log('Server running on port 3000'));
"@ | Out-File -FilePath server.js -Encoding UTF8

# 3. Update package.json
# Add: "start": "node server.js"

# 4. Run IGNIS on this project
cd "D:\Official\Assignments\PROJECTS\IGNIS\After Format\dev-Automation-test-Agent\devAutomationTestAgent"
$env:REPO_PATH="D:\path\to\test-project"
$env:AUTO_START_APP="true"
npm run cli
```

### Scenario 2: Test on Your Existing Project

```powershell
# 1. Navigate to IGNIS agent directory
cd "D:\Official\Assignments\PROJECTS\IGNIS\After Format\dev-Automation-test-Agent\devAutomationTestAgent"

# 2. Set your project path
$env:REPO_PATH="D:\Your\Project\Path"

# 3. Configure auto-start
$env:AUTO_START_APP="true"
# Or if app is already running:
# $env:APP_URL="http://localhost:3000"

# 4. Run the agent
npm run cli
```

### Scenario 3: Test Without Auto-Start (App Already Running)

```powershell
# 1. Start your application manually
cd "D:\Your\Project"
npm start  # Or your start command

# 2. In another terminal, run IGNIS
cd "D:\Official\Assignments\PROJECTS\IGNIS\After Format\dev-Automation-test-Agent\devAutomationTestAgent"
$env:REPO_PATH="D:\Your\Project"
$env:AUTO_START_APP="false"
$env:APP_URL="http://localhost:3000"
npm run cli
```

---

## ⚙️ Configuration Options

### Basic Configuration (.env)

```bash
# === REQUIRED ===
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
GITHUB_TOKEN=ghp-xxxxxxxxxxxx

# === PROJECT LOCATION ===
# Windows path format
REPO_PATH=D:/Your/Project/Path

# === AGENT BEHAVIOR ===
MAX_ITERATIONS=3              # How many fix attempts
TEST_TYPES=e2e,api           # Which tests to generate
AUTO_START_APP=true          # Auto-start your app

# === FEATURES ===
ENABLE_BACKEND_VALIDATION=true
ENABLE_BEST_PRACTICES_CHECK=true
GENERATE_ANALYSIS_REPORT=true
```

### Advanced Configuration

```bash
# === AI PROVIDER OPTIONS ===
# Use OpenAI (default)
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
OPENAI_MODEL=gpt-4o  # or gpt-4-turbo

# OR use Gemini (cheaper)
AI_PROVIDER=gemini
GEMINI_API_KEY=AIzaxxxxxxxxxxxx

# === APPLICATION CONFIGURATION ===
# If your app needs environment variables
APP_SECRETS={"DATABASE_URL":"postgresql://localhost/testdb","API_KEY":"test123"}

# Custom start command
APP_START_COMMAND=npm run dev
APP_PORT=3000

# === TESTING OPTIONS ===
TEST_TYPES=e2e,api,visual,accessibility,performance
BROWSERS=chromium
HEADLESS=true

# === OUTPUT ===
REPORT_OUTPUT_DIR=reports
LOG_LEVEL=info
LOG_DIR=logs
```

---

## 🎯 Environment Variable Quick Reference

### PowerShell Commands

```powershell
# Set variables for current session
$env:OPENAI_API_KEY="sk-proj-xxxxxxxxxxxx"
$env:GITHUB_TOKEN="ghp-xxxxxxxxxxxx"
$env:REPO_PATH="D:\Your\Project"
$env:AUTO_START_APP="true"

# Run with environment variables
npm run cli

# Or in one line
$env:REPO_PATH="D:\Your\Project"; npm run cli
```

### Command Prompt (CMD) Commands

```cmd
REM Set variables
set OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
set GITHUB_TOKEN=ghp-xxxxxxxxxxxx
set REPO_PATH=D:\Your\Project
set AUTO_START_APP=true

REM Run
npm run cli
```

---

## 🧪 Testing Workflows

### Workflow 1: Full Automation (Recommended)

```powershell
# .env configuration
REPO_PATH=D:/Your/Project
AUTO_START_APP=true
ENABLE_BACKEND_VALIDATION=true
GENERATE_ANALYSIS_REPORT=true
MAX_ITERATIONS=3

# Run
npm run cli
```

**What happens:**
1. ✅ Analyzes your codebase
2. ✅ Validates backend endpoints
3. ✅ Generates comprehensive tests
4. ✅ Starts your application
5. ✅ Runs tests
6. ✅ Fixes failures iteratively
7. ✅ Generates report
8. ✅ Creates PR (if GitHub configured)

### Workflow 2: Quick Test (Minimal)

```powershell
# .env configuration
REPO_PATH=D:/Your/Project
AUTO_START_APP=false
APP_URL=http://localhost:3000
TEST_TYPES=e2e
MAX_ITERATIONS=1
ENABLE_BACKEND_VALIDATION=false

# Run
npm run cli
```

**What happens:**
1. ✅ Analyzes codebase quickly
2. ✅ Generates only E2E tests
3. ✅ Runs tests once
4. ✅ Attempts one fix if needed

### Workflow 3: Backend Validation Only

```powershell
# .env configuration
REPO_PATH=D:/Your/Project
ENABLE_BACKEND_VALIDATION=true
ENABLE_BEST_PRACTICES_CHECK=true
GENERATE_ANALYSIS_REPORT=true
AUTO_START_APP=false  # Don't run tests

# Modify code to skip test generation...
# Or run and interrupt after validation
```

---

## 📁 Expected Output

After running, you'll see these generated files:

```
your-project/
├── generated-tests/
│   ├── e2e/
│   │   ├── homepage.spec.js
│   │   ├── navigation.spec.js
│   │   └── forms.spec.js
│   ├── api/
│   │   ├── users-api.spec.js
│   │   └── auth-api.spec.js
│   └── accessibility/
│       └── a11y.spec.js
├── reports/
│   ├── analysis-report-2026-04-29T10-30-00.md
│   └── test-results.json
├── test-results/
│   ├── ignis-summary.json
│   └── playwright-results/
└── logs/
    └── ignis-agent.log
```

---

## 🔍 Validate Your Setup

### Check 1: Verify Installation

```powershell
# Check Node.js version (need >= 18)
node --version

# Check npm
npm --version

# Verify Playwright
npx playwright --version

# Run setup validator
npm run validate
```

**Expected output:**
```
✓ Node.js: v18.x.x
✓ npm: v9.x.x
✓ Playwright: Installed
✓ AI Provider: openai
✓ AI API Key: Set
✓ GitHub Token: Set
```

### Check 2: Test Configuration

```powershell
# Test loading configuration
node -e "console.log(require('./src/config/default.js'))"
```

Should show your configuration without errors.

### Check 3: Test AI Connection

```powershell
# Create test script
@"
const { createProvider } = require('./src/ai/provider-factory');
const config = require('./src/config/default');

async function test() {
  try {
    const provider = createProvider(config);
    console.log('✓ AI Provider created successfully');
    console.log('Provider:', config.ai.provider);
    console.log('Model:', config.ai[config.ai.provider].model);
  } catch (err) {
    console.error('✗ Error:', err.message);
  }
}

test();
"@ | Out-File -FilePath test-ai.js -Encoding UTF8

# Run test
node test-ai.js

# Clean up
Remove-Item test-ai.js
```

---

## 🐛 Troubleshooting

### Issue 1: "API key required for AI provider"

**Solution:**
```powershell
# Verify .env file exists
Test-Path .env

# Check if API key is set
Get-Content .env | Select-String "OPENAI_API_KEY"

# Make sure no quotes around the key
# WRONG: OPENAI_API_KEY="sk-proj-xxx"
# RIGHT: OPENAI_API_KEY=sk-proj-xxx
```

### Issue 2: "Module not found"

**Solution:**
```powershell
# Reinstall dependencies
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
```

### Issue 3: "Playwright browsers not installed"

**Solution:**
```powershell
# Install browsers with dependencies
npx playwright install --with-deps chromium

# For Windows, you may need admin rights
# Run PowerShell as Administrator, then:
npx playwright install-deps chromium
```

### Issue 4: "Cannot find project"

**Solution:**
```powershell
# Check path exists
Test-Path "D:\Your\Project"

# Use forward slashes in .env
REPO_PATH=D:/Your/Project  # ✓ Correct

# Or escaped backslashes
REPO_PATH=D:\\Your\\Project  # ✓ Also works

# NOT this:
REPO_PATH=D:\Your\Project  # ✗ Wrong (unescaped)
```

### Issue 5: "Application won't start"

**Solution:**
```powershell
# Test starting manually first
cd "D:\Your\Project"
npm start

# Check what port it uses
# netstat -ano | findstr "LISTENING"

# Then configure IGNIS:
$env:APP_PORT="3000"  # Use the correct port
$env:AUTO_START_APP="false"
$env:APP_URL="http://localhost:3000"
```

### Issue 6: "GitHub token invalid"

**Solution:**
1. Go to https://github.com/settings/tokens
2. Generate new token (classic)
3. Select scopes: `repo`, `workflow`
4. Copy token (starts with `ghp_`)
5. Update .env: `GITHUB_TOKEN=ghp_xxxxxxxxxxxx`

### Issue 7: Rate limiting or costs

**Solution:**
```powershell
# Reduce iterations
$env:MAX_ITERATIONS="1"

# Reduce test types
$env:TEST_TYPES="e2e"

# Or switch to cheaper provider
$env:AI_PROVIDER="gemini"
$env:GEMINI_API_KEY="AIza-xxxxxxxxxxxx"
```

---

## 💡 Tips for Local Testing

### Tip 1: Start Small
```powershell
# First run with minimal config
TEST_TYPES=e2e
MAX_ITERATIONS=1
ENABLE_BACKEND_VALIDATION=false
```

### Tip 2: Use Test Projects
Create a simple test project before running on your main codebase.

### Tip 3: Monitor Costs
- OpenAI usage: https://platform.openai.com/usage
- Gemini usage: https://makersuite.google.com/app/apikey

### Tip 4: Keep Logs
```powershell
# Enable debug logging
$env:LOG_LEVEL="debug"
npm run cli 2>&1 | Tee-Object -FilePath "test-run.log"
```

### Tip 5: Test Without GitHub
For local testing without PR creation:
```powershell
# Create a dummy token (tests will run but PR creation will skip)
$env:GITHUB_TOKEN="dummy_token_for_local_testing"
```

---

## 🎬 Complete Example Session

Here's a complete example of testing on a new project:

```powershell
# 1. Setup test project
mkdir D:\test-app
cd D:\test-app
npm init -y
npm install express

# Create simple app
@"
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Hello!'));
app.listen(3000);
"@ | Out-File -FilePath index.js -Encoding UTF8

# Update package.json scripts
# "start": "node index.js"

# 2. Navigate to IGNIS
cd "D:\Official\Assignments\PROJECTS\IGNIS\After Format\dev-Automation-test-Agent\devAutomationTestAgent"

# 3. Configure
cp .env.example .env
# Edit .env with your API keys

# 4. Set test project
$env:REPO_PATH="D:\test-app"
$env:AUTO_START_APP="true"
$env:TEST_TYPES="e2e,api"
$env:MAX_ITERATIONS="2"

# 5. Run IGNIS
npm run cli

# 6. Check results
cd D:\test-app
Get-ChildItem generated-tests
Get-ChildItem reports
```

---

## 📊 Understanding the Output

### Console Output

```
[INFO] IGNIS Automation Test Agent — CLI Mode (Primary)
[INFO] Repository path: D:\Your\Project
[INFO] Base branch: main
[INFO] AI Provider: openai
[INFO] Max iterations: 3

[INFO] Status: cloning
[INFO] Status: installing
[INFO] Installing dependencies with npm...

[INFO] Status: analyzing
[INFO] Analyzing codebase...

[INFO] Status: validating-backend
[INFO] Starting backend endpoint validation...
[INFO] Backend validation complete: 3 issues found

[INFO] Status: generating
[INFO] Generating e2e tests...
[INFO] Generating api tests...

[INFO] Status: starting-app
[INFO] Starting application...
[INFO] App started on http://localhost:3000

[INFO] Status: testing
[INFO] ========== ITERATION 1/3 ==========
[INFO] Running tests...
[INFO] Tests: 10 total, 8 passed, 2 failed

[INFO] Status: fixing
[INFO] Analyzing failures...
[INFO] Applying fixes...

[INFO] Status: testing
[INFO] ========== ITERATION 2/3 ==========
[INFO] Tests: 10 total, 10 passed, 0 failed
[INFO] All tests passed!

[INFO] Status: generating-report
[INFO] Generating comprehensive analysis report...

[INFO] Status: creating-pr
[INFO] Creating pull request...

✅ All tests passed — exiting with code 0
```

### Generated Reports

**Analysis Report:** `reports/analysis-report-2026-04-29T10-30-00.md`
- Executive summary
- Security findings
- Best practices violations
- Test results
- Recommendations

**Test Results:** `test-results/ignis-summary.json`
- Detailed test outcomes
- Fixes applied
- Iteration history
- Performance metrics

---

## 🚀 Next Steps

After successful local testing:

1. **Review Generated Tests**
   ```powershell
   cd your-project/generated-tests
   Get-ChildItem -Recurse
   ```

2. **Review Reports**
   ```powershell
   notepad reports/analysis-report-*.md
   ```

3. **Run Tests Manually**
   ```powershell
   npx playwright test generated-tests/
   ```

4. **Commit Generated Tests**
   ```powershell
   git add generated-tests/
   git commit -m "Add IGNIS generated tests"
   ```

5. **Setup GitHub Actions** (for CI/CD)
   - See [README.md](./README.md) for workflow configuration

---

## 📞 Getting Help

**Documentation:**
- [README.md](./README.md) - Complete documentation
- [OPENAI-QUICK-SETUP.md](./OPENAI-QUICK-SETUP.md) - OpenAI setup
- [QUICK-START.md](./QUICK-START.md) - 5-minute guide

**Common Commands:**
```powershell
npm run validate    # Validate setup
npm run cli         # Run agent (CLI mode)
npm start          # Run API server
npm test           # Run tests
```

**Check Logs:**
```powershell
Get-Content logs/ignis-agent.log -Tail 50
```

---

## ✅ Quick Checklist

Before running IGNIS locally:

- [ ] Node.js >= 18 installed
- [ ] Dependencies installed (`npm install`)
- [ ] Playwright installed (`npx playwright install --with-deps chromium`)
- [ ] `.env` file created with API keys
- [ ] OpenAI or Gemini API key configured
- [ ] GitHub token configured
- [ ] Project path set (`REPO_PATH`)
- [ ] Setup validated (`npm run validate`)

Now run: `npm run cli` 🚀

---

**Happy Testing!** 🎉

For issues or questions, check the troubleshooting section above or review the full documentation in [README.md](./README.md).
