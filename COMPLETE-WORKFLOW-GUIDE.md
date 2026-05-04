# 🎯 IGNIS 6-Step Comprehensive Test Workflow

## Overview

IGNIS now supports a **complete 6-step workflow** matching your requirements:

1. ✅ **Backend Analysis** - Analyze code for errors, issues, and refactoring opportunities
2. ✅ **Unit Test Generation & Execution** - Generate and RUN Jest/Mocha unit tests for backend
3. ✅ **Frontend Analysis** - Analyze frontend code for errors, issues, and refactoring
4. ✅ **Playwright Test Generation & Execution** - Generate and run E2E/API/Visual/Accessibility tests
5. ✅ **Comprehensive Report Generation** - Detailed report showing all backend and frontend test outputs
6. ✅ **Pull Request Creation** - Create PR with all fixes, unit tests, and automation scripts

---

## 🚀 Quick Start - Enable Complete Workflow

### Option 1: Environment Variables (GitHub Actions)

```yaml
- name: Run IGNIS with Complete Workflow
  env:
    # Enable ALL analysis and testing
    TEST_TYPES: "unit,integration,e2e,api"
    
    # Enable backend validation
    ENABLE_BACKEND_VALIDATION: "true"
    ENABLE_BEST_PRACTICES_CHECK: "true"
    ENABLE_ENDPOINT_VALIDATION: "true"
    
    # Enable unit test execution
    RUN_UNIT_TESTS: "true"
    UNIT_TEST_FRAMEWORK: "auto"  # auto-detect, or specify "jest" / "mocha"
    
    # Enable comprehensive reporting
    GENERATE_ANALYSIS_REPORT: "true"
    REPORT_OUTPUT_DIR: "./reports"
    
    # Other settings
    MAX_ITERATIONS: "3"
    AUTO_START_APP: "true"
    LOG_LEVEL: "info"
  run: |
    docker run --rm \
      -v "${{ github.workspace }}:/workspace" \
      -e REPO_PATH=/workspace \
      -e TEST_TYPES=$TEST_TYPES \
      -e ENABLE_BACKEND_VALIDATION=$ENABLE_BACKEND_VALIDATION \
      -e ENABLE_BEST_PRACTICES_CHECK=$ENABLE_BEST_PRACTICES_CHECK \
      -e RUN_UNIT_TESTS=$RUN_UNIT_TESTS \
      -e GENERATE_ANALYSIS_REPORT=$GENERATE_ANALYSIS_REPORT \
      -e AI_API_KEY=${{ secrets.OPENAI_API_KEY }} \
      -e GITHUB_TOKEN=${{ github.token }} \
      <your-acr>.azurecr.io/automationtestagent:latest
```

### Option 2: Configuration File

Create `config/agent-config.json`:

```json
{
  "agent": {
    "maxIterations": 3,
    "enableBackendValidation": true,
    "enableBestPracticesCheck": true,
    "enableEndpointValidation": true,
    "generateAnalysisReport": true,
    "reportOutputDir": "reports"
  },
  "testing": {
    "types": ["unit", "integration", "e2e", "api"],
    "runUnitTests": true,
    "unitTestFramework": "auto"
  },
  "ai": {
    "provider": "openai",
    "openai": {
      "model": "gpt-4-turbo"
    }
  }
}
```

---

## 📋 Detailed Workflow Steps

### Step 1: Backend Error Analysis & Refactoring

**What It Does:**
- Scans all backend files (routes, controllers, services, models)
- Identifies critical issues: security vulnerabilities, error handling gaps, missing validations
- Detects best practice violations: hardcoded values, missing logging, inefficient queries
- Suggests refactoring opportunities

**Configuration:**
```bash
ENABLE_BACKEND_VALIDATION=true
ENABLE_BEST_PRACTICES_CHECK=true
ENABLE_ENDPOINT_VALIDATION=true
```

**Output:**
- `reports/backend-validation-report.json` - Detailed analysis
- Issues categorized by severity: critical, high, medium, low
- Automatic fixes applied for critical/high issues

**Example Issues Detected:**
- Missing authentication on endpoints
- SQL injection vulnerabilities
- Unhandled promise rejections
- Missing input validation
- Hardcoded credentials

---

### Step 2: Unit Test Generation & Execution 🆕

**What It Does:**
- Generates Jest or Mocha unit tests for backend functions/classes
- Tests individual units in isolation with mocked dependencies
- Runs generated tests and reports results
- Generates code coverage reports

**Configuration:**
```bash
TEST_TYPES="unit,integration"  # Add unit and/or integration
RUN_UNIT_TESTS=true
UNIT_TEST_FRAMEWORK="auto"  # or "jest" or "mocha"
```

**Output:**
- `generated-tests/tests/unit/**/*.test.js` - Generated unit tests
- `generated-tests/tests/integration/**/*.test.js` - Integration tests
- `logs/unit-test-results-*.log` - Test execution results
- `logs/unit-test-results-*.json` - Machine-readable results
- `coverage/` - Code coverage reports (HTML + LCOV)

**Example Unit Test Generated:**
```javascript
// generated-tests/tests/unit/userService.test.js
const userService = require('../../src/services/userService');

describe('UserService', () => {
  describe('createUser', () => {
    it('should create a new user with valid data', async () => {
      const userData = { name: 'John', email: 'john@example.com' };
      const result = await userService.createUser(userData);
      expect(result).toHaveProperty('id');
      expect(result.name).toBe('John');
    });

    it('should throw error for invalid email', async () => {
      const userData = { name: 'John', email: 'invalid' };
      await expect(userService.createUser(userData)).rejects.toThrow('Invalid email');
    });

    it('should handle duplicate email', async () => {
      // Test duplicate handling...
    });
  });
});
```

---

### Step 3: Frontend Analysis

**What It Does:**
- Analyzes React/Vue/Angular components
- Identifies accessibility issues
- Detects performance anti-patterns
- Finds unused code and dependencies

**Configuration:**
- Automatically enabled when frontend code is detected
- Uses CodeAnalyzer with AI-powered analysis

**Output:**
- `reports/frontend-analysis.json` - Component analysis
- Issues and recommendations for each component

---

### Step 4: Playwright Automation Test Generation

**What It Does:**
- Generates comprehensive E2E tests for user flows
- Creates API endpoint tests
- Generates visual regression tests
- Creates accessibility (a11y) tests
- Runs all tests and reports results

**Configuration:**
```bash
TEST_TYPES="e2e,api,visual,accessibility"
AUTO_START_APP=true  # Automatically start your app
```

**Output:**
- `generated-tests/e2e/**/*.spec.js` - E2E tests
- `generated-tests/api/**/*.spec.js` - API tests
- `generated-tests/visual/**/*.spec.js` - Visual tests
- `generated-tests/accessibility/**/*.spec.js` - A11y tests
- `logs/test-results-*.log` - Detailed Playwright results
- `playwright-report/` - HTML test report
- `test-results/` - Screenshots and traces

---

### Step 5: Comprehensive Report Generation

**What It Does:**
- Consolidates ALL test results into one comprehensive report
- Includes backend validation results
- Shows unit test results with coverage
- Displays Playwright test results
- Provides recommendations and next steps

**Configuration:**
```bash
GENERATE_ANALYSIS_REPORT=true
REPORT_OUTPUT_DIR="./reports"
```

**Output:**
- `reports/comprehensive-report.html` - Visual HTML report
- `reports/comprehensive-report.json` - Machine-readable data
- `logs/run-summary-*.log` - Text-based summary

**Report Includes:**
```
═══════════════════════════════════════════════════════════════════
IGNIS COMPREHENSIVE TEST REPORT
Run ID: abc123-def456
Date: 2026-05-04 14:30:00
═══════════════════════════════════════════════════════════════════

📊 OVERALL STATUS: ALL PASSED

📋 SUMMARY
────────────────────────────────────────────────────────────────────
Repository:        /workspace
Branch:            main
Duration:          5m 42s
AI Provider:       OpenAI GPT-4 Turbo

🔍 BACKEND ANALYSIS
────────────────────────────────────────────────────────────────────
Files Analyzed:    47
Issues Found:      12 (3 critical, 5 high, 4 medium)
Fixes Applied:     8 (3 critical, 5 high)
Status:            ✅ Critical issues resolved

🧪 UNIT TESTS (Jest)
────────────────────────────────────────────────────────────────────
Total Tests:       156
✅ Passed:         154
❌ Failed:         2
Coverage:          87.4%
  - Lines:         89.2%
  - Statements:    88.1%
  - Branches:      84.3%
  - Functions:     91.2%

🎭 PLAYWRIGHT TESTS
────────────────────────────────────────────────────────────────────
E2E Tests:         24 passed
API Tests:         18 passed
Visual Tests:      8 passed
Accessibility:     12 passed
Total:             62/62 passed ✅

🎯 FRONTEND ANALYSIS
────────────────────────────────────────────────────────────────────
Components:        32
Accessibility:     98.5% compliant
Performance:       Good (no critical issues)

📦 GENERATED ARTIFACTS
────────────────────────────────────────────────────────────────────
✅ 156 unit tests (generated-tests/tests/unit/)
✅ 62 Playwright tests (generated-tests/e2e/, api/, etc.)
✅ Backend fixes (8 files modified)
✅ Code coverage report (coverage/index.html)
✅ Playwright HTML report (playwright-report/index.html)

🔀 PULL REQUEST
────────────────────────────────────────────────────────────────────
PR #123: IGNIS - Automated Tests & Fixes
URL: https://github.com/your-org/your-repo/pull/123
Files Changed: 172 (8 fixes, 164 tests)
Status: ✅ Ready for Review

💡 RECOMMENDATIONS
────────────────────────────────────────────────────────────────────
1. Review 2 failing unit tests in userService.test.js
2. Increase test coverage for auth module (currently 72%)
3. Add integration tests for payment flow
4. Consider adding performance tests for API endpoints

═══════════════════════════════════════════════════════════════════
```

---

### Step 6: Pull Request Creation

**What It Does:**
- Commits all generated tests to a new branch
- Commits applied fixes to backend code
- Creates a comprehensive PR with all changes
- Includes test results and recommendations in PR description

**Configuration:**
- Automatically happens if `GITHUB_TOKEN` is provided
- PR created with descriptive title and body

**PR Contents:**
- Backend fixes (8 files)
- Unit tests (156 files)
- Integration tests (12 files)
- Playwright tests (62 files)
- Test configurations (jest.config.js, playwright.config.js)

**PR Description Auto-Generated:**
```markdown
## 🤖 IGNIS Automated Testing & Fixes

### Summary
This PR contains automated tests and fixes generated by IGNIS Test Agent.

### Changes
- ✅ Fixed 8 critical/high severity backend issues
- ✅ Generated 156 unit tests (87.4% coverage)
- ✅ Generated 62 Playwright tests (E2E, API, Visual, A11y)
- ✅ All tests passing

### Backend Fixes Applied
1. Added authentication to `/api/admin` endpoints
2. Fixed SQL injection vulnerability in user search
3. Added error handling to payment processing
4. Implemented input validation on registration endpoint
5. Fixed unhandled promise rejection in email service
... (3 more)

### Test Results
- **Unit Tests:** 154/156 passed (98.7%)
- **Playwright Tests:** 62/62 passed (100%)
- **Coverage:** 87.4% (target: 80%)

### Recommendations
1. Review 2 failing unit tests
2. Manual testing recommended for payment flow
3. Consider adding load testing

### Files Changed
- `src/api/routes/admin.js` - Added authentication
- `src/services/userService.js` - Fixed SQL injection
- `generated-tests/tests/unit/**` - 156 new unit tests
- `generated-tests/e2e/**` - 24 new E2E tests
... (view all files)
```

---

## 📁 Output Directory Structure

After running the complete workflow:

```
your-repo/
├── generated-tests/
│   ├── tests/
│   │   ├── unit/                # Unit tests (Jest/Mocha)
│   │   │   ├── userService.test.js
│   │   │   ├── authController.test.js
│   │   │   └── ...
│   │   └── integration/         # Integration tests
│   │       ├── api.test.js
│   │       └── ...
│   ├── e2e/                     # E2E tests (Playwright)
│   │   ├── login.spec.js
│   │   ├── userFlow.spec.js
│   │   └── ...
│   ├── api/                     # API tests (Playwright)
│   │   ├── users.spec.js
│   │   └── ...
│   ├── jest.config.js           # Jest configuration
│   └── playwright.config.js     # Playwright configuration
├── logs/
│   ├── combined.log             # All logs
│   ├── error.log                # Error logs only
│   ├── unit-test-results-*.log  # Unit test results
│   ├── test-results-*.log       # Playwright results
│   └── run-summary-*.log        # Complete summary
├── reports/
│   ├── comprehensive-report.html     # Main report
│   ├── comprehensive-report.json     # Machine-readable
│   ├── backend-validation.json       # Backend analysis
│   └── frontend-analysis.json        # Frontend analysis
├── coverage/                    # Code coverage (Jest)
│   ├── index.html              # Coverage report
│   └── lcov.info               # LCOV format
├── playwright-report/           # Playwright HTML report
│   └── index.html
└── test-results/                # Test artifacts
    ├── results.json            # Playwright results
    └── screenshots/            # Test screenshots
```

---

## 🎯 GitHub Actions Integration

Complete workflow example:

```yaml
name: IGNIS Complete Testing Workflow

on:
  pull_request:
  push:
    branches: [main, develop]
  workflow_dispatch:

jobs:
  ignis-complete-workflow:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Run IGNIS Complete Workflow
        run: |
          docker run --rm \
            -v "${{ github.workspace }}:/workspace" \
            -e REPO_PATH=/workspace \
            -e REPO_BRANCH="${{ github.ref_name }}" \
            -e GITHUB_TOKEN="${{ github.token }}" \
            -e AI_API_KEY="${{ secrets.OPENAI_API_KEY }}" \
            -e TEST_TYPES="unit,integration,e2e,api" \
            -e ENABLE_BACKEND_VALIDATION=true \
            -e ENABLE_BEST_PRACTICES_CHECK=true \
            -e RUN_UNIT_TESTS=true \
            -e GENERATE_ANALYSIS_REPORT=true \
            -e AUTO_START_APP=true \
            -e MAX_ITERATIONS=3 \
            -e LOG_LEVEL=info \
            ${{ secrets.ACR_REGISTRY_URL }}/automationtestagent:latest
      
      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ignis-complete-results
          path: |
            generated-tests/
            logs/
            reports/
            coverage/
            playwright-report/
            test-results/
          retention-days: 30
      
      - name: Upload Coverage to Codecov
        if: always()
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: unittests
          name: codecov-ignis
```

---

## 🔧 Troubleshooting

### Unit Tests Not Running

**Issue:** Unit tests are generated but not executed

**Solution:**
```bash
# Ensure RUN_UNIT_TESTS is enabled
RUN_UNIT_TESTS=true

# Check if test framework is installed
cd generated-tests
npm install --save-dev jest @types/jest

# Run manually to test
npx jest tests/unit/
```

### Backend Validation Disabled

**Issue:** No backend analysis appearing in reports

**Solution:**
```bash
# Enable all backend validation flags
ENABLE_BACKEND_VALIDATION=true
ENABLE_BEST_PRACTICES_CHECK=true
ENABLE_ENDPOINT_VALIDATION=true
```

### Reports Not Generated

**Issue:** Missing comprehensive reports

**Solution:**
```bash
# Enable report generation
GENERATE_ANALYSIS_REPORT=true
REPORT_OUTPUT_DIR="./reports"

# Check logs for errors
cat logs/error.log
```

---

## 📚 Additional Resources

- [Container Troubleshooting](./CONTAINER-TROUBLESHOOTING.md)
- [GitHub Actions Log Access](./GITHUB-ACTIONS-LOG-ACCESS.md)
- [Production Deployment Guide](./PRODUCTION-DEPLOYMENT-GUIDE.md)
- [API Documentation](./IGNIS-API-DOCUMENTATION.md)

---

**🎉 You're now ready to run the complete 6-step workflow!**

Build the updated image and deploy:
```bash
cd devAutomationTestAgent
npm run build:production
```
