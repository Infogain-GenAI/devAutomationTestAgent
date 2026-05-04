# GitHub Actions Log Access Guide

**Version:** 2.0.0  
**Date:** May 4, 2026

This guide explains how to access comprehensive test results and logs when running IGNIS Test Agent in GitHub Actions.

---

## 📋 Overview

When running in GitHub Actions, container logs are not directly accessible. The IGNIS Test Agent now writes comprehensive logs to files that can be uploaded as artifacts for easy access.

---

## 📁 Log Files Created

### 1. Test Run Logs
**Location:** `logs/test-run-*.log`  
**Contains:** Raw Playwright test output (stdout/stderr)

**Format:**
```
════════════════════════════════════════════════════════════════════════════════
PLAYWRIGHT TEST RUN LOG
Timestamp: 2026-05-04T10:30:45.123Z
Exit Code: 0
Working Directory: /workspace/my-app
Test Directory: /workspace/my-app/generated-tests
════════════════════════════════════════════════════════════════════════════════

STDOUT:
────────────────────────────────────────────────────────────────────────────────
Running 5 tests using 2 workers
  ✓ Test 1 passed (120ms)
  ✓ Test 2 passed (95ms)
  ...
```

### 2. Detailed Test Results
**Location:** `logs/test-results-*.log`  
**Contains:** Formatted test results with summaries, failures, and recommendations

**Format:**
```
════════════════════════════════════════════════════════════════════════════════
DETAILED TEST RESULTS - IGNIS Automation Test Agent
════════════════════════════════════════════════════════════════════════════════

📊 SUMMARY
────────────────────────────────────────────────────────────────────────────────
Total Tests:     10
✅ Passed:       8
❌ Failed:       2
⏭️  Skipped:      0
⏱️  Duration:     12.45s
🚪 Exit Code:    1

❌ STATUS: 2 TEST(S) FAILED

════════════════════════════════════════════════════════════════════════════════
📝 DETAILED TEST RESULTS
════════════════════════════════════════════════════════════════════════════════

1. ✅ GET / should return welcome message
   File:     tests/api/home.spec.js
   Status:   PASSED
   Duration: 0.12s

2. ❌ POST /api/users should create user
   File:     tests/api/users.spec.js
   Status:   FAILED
   Duration: 2.45s
   Error:    Expected status code 201 but got 500

...

════════════════════════════════════════════════════════════════════════════════
❌ FAILURE DETAILS
════════════════════════════════════════════════════════════════════════════════

FAILURE #1
────────────────────────────────────────────────────────────────────────────────
Test:     POST /api/users should create user
File:     tests/api/users.spec.js
Category: backend

Error Message:
Expected status code 201 but got 500

Stack Trace:
Error: expect(received).toBe(expected)
    at tests/api/users.spec.js:25:40
    ...

════════════════════════════════════════════════════════════════════════════════
📊 FAILURE BREAKDOWN BY CATEGORY
════════════════════════════════════════════════════════════════════════════════

⚙️ BACKEND: 2 failure(s)

════════════════════════════════════════════════════════════════════════════════
💡 RECOMMENDATIONS
════════════════════════════════════════════════════════════════════════════════

⚠️  Backend issues detected:
   - Review API endpoint implementations
   - Check server logs for errors
   - Verify database connectivity
   - Review API response formats
```

### 3. Test Results JSON
**Location:** `logs/test-results-*.json`  
**Contains:** Machine-readable test results

**Format:**
```json
{
  "passed": 8,
  "failed": 2,
  "skipped": 0,
  "total": 10,
  "duration": 12450,
  "exitCode": 1,
  "failures": [
    {
      "testName": "POST /api/users should create user",
      "file": "tests/api/users.spec.js",
      "error": "Expected status code 201 but got 500",
      "stackTrace": "...",
      "category": "backend"
    }
  ],
  "allTests": [...]
}
```

### 4. Run Summary Log
**Location:** `logs/run-summary-*.log`  
**Contains:** Complete run summary with analysis, tests, fixes, and status

**Format:**
```
════════════════════════════════════════════════════════════════════════════════
IGNIS AUTOMATION TEST AGENT - RUN SUMMARY
════════════════════════════════════════════════════════════════════════════════

📊 OVERALL STATUS
────────────────────────────────────────────────────────────────────────────────
Status:      ALL-PASSED
Duration:    120.34s
Iterations:  1

🧪 TEST RESULTS
────────────────────────────────────────────────────────────────────────────────
Total Tests:  10
✅ Passed:    10
❌ Failed:    0
⏭️  Skipped:   0

🔍 CODE ANALYSIS
────────────────────────────────────────────────────────────────────────────────
Files Analyzed: 25
Total Size:     145.23 KB
Routes Detected: 5
API Endpoints:  8

📝 GENERATED TESTS
────────────────────────────────────────────────────────────────────────────────
Test Files Created: 2
   - e2e/homepage.spec.js
   - api/users-api.spec.js

🎯 FINAL STATUS
────────────────────────────────────────────────────────────────────────────────
✅ SUCCESS: All tests passed!
```

---

## 🚀 Accessing Logs in GitHub Actions

### Method 1: Upload Artifacts (Recommended)

Add this to your workflow after the IGNIS step:

```yaml
- name: Run IGNIS Test Agent
  uses: your-org/ignis-test-agent@v2
  with:
    ai-provider: 'openai'
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Upload IGNIS Logs and Results
  if: always()  # Run even if tests fail
  uses: actions/upload-artifact@v4
  with:
    name: ignis-test-results
    path: |
      logs/
      test-results/
      reports/
      generated-tests/
    retention-days: 30
```

**Access:** Go to your workflow run → "Summary" tab → "Artifacts" section → Download "ignis-test-results"

### Method 2: View in Workflow Summary

The IGNIS agent automatically writes to `$GITHUB_STEP_SUMMARY`, which appears in the workflow run summary.

**Access:** Go to your workflow run → "Summary" tab → Scroll down to see formatted summary

### Method 3: View Workflow Logs

Console output is also visible in the workflow logs.

**Access:** Go to your workflow run → Click on the IGNIS job → View step logs

---

## 📦 Recommended Workflow Configuration

### Complete Example

```yaml
name: IGNIS Automation Testing

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Run IGNIS Test Agent
        uses: your-org/ignis-test-agent@v2
        with:
          ai-provider: 'openai'
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
          test-types: 'e2e,api'
          max-iterations: '3'
          auto-start-app: 'true'
          app-start-command: 'npm start'
      
      # IMPORTANT: Upload artifacts even if tests fail
      - name: Upload IGNIS Logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ignis-logs-${{ github.run_number }}
          path: logs/
          retention-days: 30
      
      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results-${{ github.run_number }}
          path: |
            test-results/
            generated-tests/
            playwright-report/
          retention-days: 30
      
      - name: Upload Analysis Reports
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: analysis-reports-${{ github.run_number }}
          path: reports/
          retention-days: 30
```

---

## 🔍 Finding Specific Information

### To Find Test Failures
1. Download `ignis-test-results` artifact
2. Open `logs/test-results-*.log`
3. Look for the "❌ FAILURE DETAILS" section

### To See Raw Test Output
1. Download `ignis-test-results` artifact
2. Open `logs/test-run-*.log`
3. Check STDOUT and STDERR sections

### To Get Run Summary
1. Download `ignis-test-results` artifact
2. Open `logs/run-summary-*.log`
3. See complete overview including status, analysis, and recommendations

### To Parse Results Programmatically
1. Download `ignis-test-results` artifact
2. Parse `logs/test-results-*.json` or `test-results/ignis-summary.json`
3. Use JSON data in scripts or dashboards

---

## 💡 Troubleshooting

### Logs Not Found in Artifacts

**Problem:** Artifacts don't contain log files  
**Solution:**
1. Ensure `if: always()` is added to upload-artifact step
2. Check that logs directory exists: `ls -la logs/` in a workflow step
3. Verify LOG_DIR environment variable is not overriding default

### Can't Download Artifacts

**Problem:** Artifact download fails  
**Solution:**
1. Check retention period hasn't expired
2. Ensure you have read access to the repository
3. Try downloading from GitHub CLI: `gh run download <run-id>`

### Logs Are Empty or Incomplete

**Problem:** Log files exist but have no content  
**Solution:**
1. Check if IGNIS agent completed successfully
2. Verify test runner executed (check workflow logs)
3. Ensure LOG_LEVEL is not set to 'error' only

---

## 📊 Log Retention Best Practices

### Recommended Settings

```yaml
retention-days: 30  # For active development
retention-days: 90  # For production/compliance
retention-days: 7   # For frequent test runs (cost optimization)
```

### Artifact Storage Limits

- Free tier: 500 MB storage
- Pro tier: 2 GB storage
- Enterprise: 50 GB storage

**Tip:** Use shorter retention for frequent runs, longer for releases

---

## 🎯 Quick Reference

### Log File Summary Table

| File Pattern | Contains | Best For |
|--------------|----------|----------|
| `test-run-*.log` | Raw Playwright output | Debugging test execution |
| `test-results-*.log` | Formatted test results | Understanding failures |
| `test-results-*.json` | JSON test data | Programmatic analysis |
| `run-summary-*.log` | Complete run overview | High-level status |
| `combined.log` | All IGNIS agent logs | Debugging agent issues |
| `error.log` | Error-level logs only | Quick error review |

### Quick Commands

```bash
# Download all artifacts for a run
gh run download <run-id>

# List artifacts for a run
gh run view <run-id>

# Download specific artifact
gh run download <run-id> -n ignis-test-results

# View latest run artifacts
gh run list --limit 1
gh run download $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
```

---

## 📞 Support

If logs are not accessible or incomplete:
1. Check workflow configuration follows this guide
2. Verify `if: always()` is on upload-artifact steps
3. Review IGNIS agent logs in workflow output
4. Check GitHub Actions quotas and limits

---

**Last Updated:** May 4, 2026  
**Version:** 2.0.0  
**Status:** ✅ Production Ready
