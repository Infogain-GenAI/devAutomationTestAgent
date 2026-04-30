# 🚀 Quick Start - Local Testing

## Three Ways to Test Locally

### Option 1: Automated Setup (Recommended - PowerShell)

```powershell
# Run the setup script
.\setup-local.ps1
```

The script will:
- ✅ Check prerequisites
- ✅ Install dependencies
- ✅ Install Playwright browsers
- ✅ Guide you through configuration
- ✅ Validate setup
- ✅ Run the agent

### Option 2: Quick Test (Windows CMD)

```cmd
quick-test.bat
```

### Option 3: Manual Setup

```powershell
# 1. Install dependencies
npm install
npx playwright install chromium --with-deps

# 2. Configure
cp .env.example .env
notepad .env
# Add your OPENAI_API_KEY and GITHUB_TOKEN

# 3. Set your project path
$env:REPO_PATH="D:\path\to\your\project"

# 4. Run
npm run cli
```

---

## Minimum Requirements

```bash
# .env file
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
GITHUB_TOKEN=ghp-xxxxxxxxxxxx
REPO_PATH=D:/path/to/your/project
```

Get keys from:
- **OpenAI:** https://platform.openai.com/api-keys
- **GitHub:** https://github.com/settings/tokens (scopes: `repo`, `workflow`)

---

## Test Commands

```powershell
# Full setup in one command
npm run setup

# Validate configuration
npm run validate

# Run on current directory
npm run cli

# Run on specific project
$env:REPO_PATH="D:\Your\Project"; npm run cli

# Quick test with minimal features
$env:TEST_TYPES="e2e"; $env:MAX_ITERATIONS="1"; npm run cli
```

---

## What Happens When You Run?

```
1. Analyzes your codebase
2. Validates backend security
3. Generates Playwright tests
4. Auto-starts your app
5. Runs tests
6. Fixes failures iteratively
7. Creates report
8. (Optional) Creates PR
```

---

## Output

After running, check:
- **`generated-tests/`** - Your test files
- **`reports/`** - Analysis reports
- **`test-results/`** - Test results
- **`logs/`** - Debug logs

---

## Troubleshooting

### "API key required"
```powershell
# Check .env file
Get-Content .env | Select-String "API_KEY"
```

### "Module not found"
```powershell
npm install
```

### "Playwright not installed"
```powershell
npx playwright install chromium --with-deps
```

### "Cannot find project"
```powershell
# Use forward slashes in .env
REPO_PATH=D:/Your/Project  # ✓ Correct
```

---

## Examples

### Test a Node.js Express App
```powershell
$env:REPO_PATH="D:\my-express-app"
$env:AUTO_START_APP="true"
$env:APP_START_COMMAND="npm start"
npm run cli
```

### Test Already Running App
```powershell
# Start your app first
cd D:\my-app
npm start

# In another terminal
cd D:\path\to\ignis-agent
$env:REPO_PATH="D:\my-app"
$env:AUTO_START_APP="false"
$env:APP_URL="http://localhost:3000"
npm run cli
```

### Quick E2E Test Only
```powershell
$env:REPO_PATH="D:\my-app"
$env:TEST_TYPES="e2e"
$env:MAX_ITERATIONS="1"
npm run cli
```

---

## Need Help?

📖 **Full Documentation:** [LOCAL-TESTING-GUIDE.md](./LOCAL-TESTING-GUIDE.md)  
📖 **Complete README:** [README.md](./README.md)  
📖 **OpenAI Setup:** [OPENAI-QUICK-SETUP.md](./OPENAI-QUICK-SETUP.md)

---

**Happy Testing!** 🎉
