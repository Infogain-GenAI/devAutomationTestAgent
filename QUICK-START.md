# IGNIS Test Agent - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Step 1: Add GitHub Action Workflow

Copy this to `.github/workflows/ignis-testing.yml` in your repository:

```yaml
name: IGNIS Testing

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Checkout IGNIS Agent
        uses: actions/checkout@v4
        with:
          repository: your-org/ignis-test-agent
          path: .ignis-agent
      
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - run: npm ci
        working-directory: .ignis-agent
      
      - run: npx playwright install --with-deps chromium
      
      - name: Run IGNIS
        run: node .ignis-agent/src/cli.js
        env:
          REPO_PATH: ${{ github.workspace }}
          REPO_BRANCH: main
          AI_PROVIDER: claude
          CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
          GITHUB_TOKEN: ${{ github.token }}
          ENABLE_BACKEND_VALIDATION: 'true'
          ENABLE_BEST_PRACTICES_CHECK: 'true'
          GENERATE_ANALYSIS_REPORT: 'true'
      
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: ignis-results
          path: |
            reports/
            generated-tests/
```

### Step 2: Configure Secrets

In GitHub repository settings → Secrets → Actions:

1. Add `CLAUDE_API_KEY` (or `OPENAI_API_KEY` or `GEMINI_API_KEY`)
2. Optionally add `APP_SECRETS` for your app

### Step 3: Run!

- Push to main branch, or
- Click "Actions" → "IGNIS Testing" → "Run workflow"

### Step 4: Review Results

The agent will:
1. ✅ Analyze your entire codebase
2. ✅ Validate backend endpoints
3. ✅ Check best practices
4. ✅ Generate automated tests
5. ✅ Create PR with fixes
6. ✅ Generate comprehensive report

## 📊 What You Get

### Backend Validation Report
- Security vulnerabilities detected
- Best practices violations
- Performance concerns
- Code quality issues

### Automated Tests
- E2E tests with Playwright
- API endpoint tests
- Visual regression tests
- Accessibility tests
- Performance tests

### Comprehensive Analysis Report
```
reports/analysis-report-2026-04-27T10-30-00.md
```

Contains:
- Executive Summary
- Security Analysis
- Performance Analysis  
- Root Cause Analysis (RCA)
- Detailed Recommendations
- Fixes Applied

### Pull Request with Fixes
- Backend code fixes
- Test improvements
- Detailed explanations

## ⚙️ Configuration Options

### Minimal Configuration
```yaml
env:
  REPO_PATH: ${{ github.workspace }}
  AI_PROVIDER: claude
  CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
  GITHUB_TOKEN: ${{ github.token }}
```

### Full Configuration
```yaml
env:
  # Repository
  REPO_PATH: ${{ github.workspace }}
  REPO_BRANCH: main
  FIX_BRANCH_PREFIX: ignis/fix
  
  # AI Provider
  AI_PROVIDER: claude
  CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
  
  # Features
  ENABLE_BACKEND_VALIDATION: 'true'
  ENABLE_BEST_PRACTICES_CHECK: 'true'
  ENABLE_ENDPOINT_VALIDATION: 'true'
  GENERATE_ANALYSIS_REPORT: 'true'
  
  # Testing
  MAX_ITERATIONS: '3'
  TEST_TYPES: 'e2e,api,visual,accessibility,performance'
  
  # App
  AUTO_START_APP: 'true'
  
  # GitHub
  GITHUB_TOKEN: ${{ github.token }}
```

## 🐳 Docker Deployment

```bash
# Build
docker build -t ignis-test-agent .

# Run
docker run -d \
  -e GITHUB_TOKEN=your_token \
  -e CLAUDE_API_KEY=your_key \
  -p 4000:4000 \
  ignis-test-agent
```

## 🔍 Example Output

### Backend Validation
```
✅ Validated 47 endpoints
⚠️  Found 12 issues:
   - 2 Critical (SQL injection risks)
   - 5 High (missing auth checks)
   - 3 Medium (input validation)
   - 2 Low (code style)
```

### Test Generation
```
✅ Generated 156 tests:
   - 45 E2E tests
   - 67 API tests
   - 20 Visual tests
   - 15 Accessibility tests
   - 9 Performance tests
```

### Auto-Fix Results
```
✅ Applied 8 fixes:
   - Fixed SQL injection in /api/users
   - Added auth middleware to /api/admin
   - Improved error handling in handlers
   - Fixed async/await patterns
```

## 📖 Documentation

- [Complete Deployment Guide](./DEPLOYMENT-GUIDE.md)
- [Example Workflow](.github/workflows/example-comprehensive.yml)
- [Configuration Reference](./README.md)

## 🆘 Troubleshooting

### Tests not generating?
Check that code analysis completed:
```bash
# View logs
cat logs/ignis-agent-*.log | grep "analyzing"
```

### PR not created?
Verify GitHub token permissions:
```yaml
permissions:
  contents: write
  pull-requests: write
```

### Backend validation skipped?
Ensure feature is enabled:
```yaml
ENABLE_BACKEND_VALIDATION: 'true'
```

## 💡 Tips

1. **Start Simple**: Use minimal config first
2. **Review Reports**: Check `reports/` directory  
3. **Customize Prompts**: Edit `config/analysis-prompts.json`
4. **Monitor Costs**: Set `MAX_ITERATIONS=1` initially
5. **Use Artifacts**: Download from GitHub Actions

## 🎯 Common Use Cases

### Use Case 1: Daily Security Audit
```yaml
on:
  schedule:
    - cron: '0 2 * * *'  # 2 AM daily
```

### Use Case 2: PR Validation
```yaml
on:
  pull_request:
    branches: [ main ]
```

### Use Case 3: Pre-Release Testing
```yaml
on:
  push:
    tags:
      - 'v*'
```

## 🚀 Next Steps

1. ✅ Set up GitHub Action
2. ✅ Configure secrets
3. ✅ Run first test
4. ✅ Review generated report
5. ✅ Merge PR with fixes
6. ✅ Customize validation rules
7. ✅ Schedule regular runs

## 📧 Support

- GitHub Issues: Report bugs or request features
- Logs: Check `logs/` directory
- Reports: Review `reports/*.md`

---

**Ready to start?** Copy the workflow above and push to your repository! 🎉
