# IGNIS Stateful Knowledge Base — Token Optimization System

**Version:** 1.0  
**Purpose:** Persist analysis across runs to minimize token consumption  
**Location:** `.ignis-kb/` (persisted in repo)  
**Update Frequency:** Per run, incrementally enhanced

---

## 1. Knowledge Base Structure

```
.ignis-kb/
├── project-metadata.json        # Project identity (hash-based)
├── tech-stack-final.json        # Detected tech stack (immutable per repo)
├── code-analysis-cache.json     # Code structure (updated incrementally)
├── api-endpoints-catalog.json   # Discovered endpoints (accumulated)
├── test-patterns-learned.json   # Test generation patterns (learned)
├── coverage-baselines.json      # Coverage benchmarks per module
├── failures-history.json        # Failed tests and fixes applied
└── run-metadata.json            # Last run info (timestamp, commit, metrics)
```

---

## 2. Workflow Integration

### On First Run
```
1. KB doesn't exist → Run full analysis
2. Store all results in .ignis-kb/
3. Generate tests normally
4. Execute tests
5. On next run: Use cached data
```

### On Subsequent Runs
```
1. Load .ignis-kb/project-metadata.json
2. Verify current repo hash matches cached metadata
3. If MATCH:
   - Skip code analysis (use cached)
   - Skip tech stack detection (use cached)
   - Use cached API catalog for test generation
   - Generate ONLY NEW/CHANGED tests
   - Save token consumption by ~60%
4. If MISMATCH or no KB:
   - Start fresh analysis
   - Update all KB files
```

---

## 3. Project Metadata (project-metadata.json)

```json
{
  "projectName": "target-app",
  "projectHash": "abc123def456...",
  "repoUrl": "https://github.com/org/repo",
  "branch": "main",
  "lastAnalyzedCommit": "e1f2g3h4i5j6k7l8",
  "lastUpdatedDate": "2026-06-15T10:30:00Z",
  "analysisVersion": "2.0.0",
  "cacheValid": true,
  "invalidationReason": null
}
```

**How to compute projectHash:**
- Hash of: `package.json` + `src/` directory structure + main tsconfig
- Invalidate if: dependency count changes >10% or major file structure changes

---

## 4. Tech Stack Cache (tech-stack-final.json)

```json
{
  "runtime": "node",
  "nodeVersion": "18",
  "packageManager": "npm",
  "frameworks": ["express", "react", "typeorm"],
  "databases": ["postgresql"],
  "testFrameworks": ["jest", "mocha"],
  "browsers": ["chromium", "firefox"],
  "detectionMethod": "ai-assisted",
  "confidence": 0.95,
  "timestamp": "2026-06-15T10:30:00Z",
  "cacheExpiry": "never"
}
```

**Token Savings:** Skips entire `StackDetector` analysis (~5K tokens per run)

---

## 5. Code Analysis Cache (code-analysis-cache.json)

```json
{
  "structure": {
    "totalFiles": 245,
    "srcFiles": 180,
    "testFiles": 45,
    "configFiles": 20
  },
  "modules": {
    "auth": {
      "files": ["src/auth/index.ts", "src/auth/guard.ts"],
      "exports": ["AuthGuard", "LoginHandler"],
      "coverage": "72%",
      "lastUpdated": "2026-06-15T10:30:00Z"
    },
    "api": {
      "files": ["src/api/routes.ts"],
      "exports": ["ApiRouter"],
      "coverage": "68%",
      "lastUpdated": "2026-06-15T10:30:00Z"
    }
  },
  "keyPaths": {
    "srcRoot": "src/",
    "testRoot": "test/",
    "configRoot": "./"
  }
}
```

**Token Savings:** Skips 3-layer code analysis (~8K tokens per run)  
**Incremental Update:** Only analyze changed files (git diff)

---

## 6. API Endpoints Catalog (api-endpoints-catalog.json)

```json
{
  "discovered": [
    {
      "method": "POST",
      "path": "/api/auth/login",
      "handler": "AuthController.login",
      "parameters": ["email", "password"],
      "returns": "AuthToken",
      "secured": true,
      "lastTested": "2026-06-15T10:30:00Z",
      "testCoverage": "unit+e2e"
    },
    {
      "method": "GET",
      "path": "/api/users/:id",
      "handler": "UserController.getById",
      "parameters": ["id"],
      "returns": "User",
      "secured": true,
      "lastTested": "2026-06-15T10:30:00Z",
      "testCoverage": "unit+e2e"
    }
  ],
  "totalEndpoints": 42,
  "testedEndpoints": 38,
  "lastUpdated": "2026-06-15T10:30:00Z"
}
```

**Token Savings:** Reuse known endpoints instead of re-analyzing (~4K tokens per run)

---

## 7. Test Patterns Learned (test-patterns-learned.json)

```json
{
  "unitTestTemplate": "Jest with supertest",
  "e2eTestTemplate": "Playwright with baseURL",
  "commonSetupCode": "beforeEach: initialize app, connect DB",
  "commonTeardownCode": "afterEach: cleanup DB, close app",
  "dataFactoryPattern": "FactoryBot-style fixtures",
  "mockingStrategy": "jest.mock for external APIs",
  "generationInstructions": "Generate 5-7 test cases per endpoint focusing on...",
  "failurePatterns": [
    {
      "pattern": "Timeout on database query",
      "fixApplied": "Increased timeout to 5s + added retry",
      "frequency": 3
    }
  ]
}
```

**Token Savings:** Reuse prompts and patterns instead of regenerating (~3K tokens per run)

---

## 8. Coverage Baselines (coverage-baselines.json)

```json
{
  "unitCoverageByModule": {
    "auth": 72,
    "api": 68,
    "database": 85,
    "utils": 90
  },
  "automationCoverageByType": {
    "e2e": 65,
    "api": 72,
    "visual": 40
  },
  "overallTarget": 95,
  "lastUpdated": "2026-06-15T10:30:00Z",
  "trend": "improving"
}
```

**Usage:** Detect which modules need more testing focus without re-analyzing.

---

## 9. Failures History (failures-history.json)

```json
{
  "recentFailures": [
    {
      "testName": "should handle invalid email",
      "file": "auth.spec.js",
      "failureReason": "Assertion failed: expected 400 but got 200",
      "fixApplied": "Added input validation to AuthController",
      "status": "fixed",
      "date": "2026-06-15T10:30:00Z"
    }
  ],
  "commonIssues": [
    {
      "issue": "Timeout on slow endpoint",
      "frequency": 5,
      "solution": "Increase Playwright timeout"
    }
  ]
}
```

**Usage:** Avoid repeating same fixes; inform fix generation strategy.

---

## 10. Run Metadata (run-metadata.json)

```json
{
  "lastRunDate": "2026-06-15T10:30:00Z",
  "lastRunCommit": "e1f2g3h4i5j6k7l8",
  "lastRunDuration": 3600,
  "lastRunStatus": "success",
  "lastCoverageUnit": 72,
  "lastCoverageAutomation": 65,
  "testFilesGenerated": 12,
  "testsPassed": 145,
  "testsFailed": 3,
  "tokenUsage": {
    "input": 15000,
    "output": 8000,
    "total": 23000
  },
  "kbHitRate": 0.85
}
```

---

## 11. Loading & Validation Logic

### Pseudo-code for KB Usage:

```javascript
async function loadOrCreateKB(workDir) {
  const kbDir = path.join(workDir, '.ignis-kb');
  
  // Load metadata
  const metadata = loadJSON(path.join(kbDir, 'project-metadata.json'));
  
  if (!metadata || metadata.cacheValid === false) {
    logger.info('[KB] Cache miss or invalid — running full analysis');
    return await runFullAnalysis(workDir);
  }
  
  const currentHash = computeProjectHash(workDir);
  if (currentHash !== metadata.projectHash) {
    logger.info('[KB] Project changed — updating KB incrementally');
    return await updateKBIncrementally(workDir, metadata);
  }
  
  logger.info('[KB] Using cached knowledge base');
  return {
    techStack: loadJSON(path.join(kbDir, 'tech-stack-final.json')),
    analysis: loadJSON(path.join(kbDir, 'code-analysis-cache.json')),
    endpoints: loadJSON(path.join(kbDir, 'api-endpoints-catalog.json')),
    patterns: loadJSON(path.join(kbDir, 'test-patterns-learned.json')),
    source: 'cache'
  };
}
```

---

## 12. Token Consumption Reduction

### Before (No KB)
```
Per Run:
- Tech stack detection: 5K tokens
- Code analysis (3-layer): 8K tokens
- Endpoint discovery: 4K tokens
- Test generation prompts: 3K tokens
- Total Input: ~20K tokens per run
```

### After (With KB)
```
First Run:
- All analysis: 20K tokens (same as before)

Subsequent Runs (cache hit):
- Load KB: 0 tokens
- Skip analysis: -20K tokens
- Generate only new tests: +2K tokens (for deltas only)
- Total Input: ~2K tokens per run
```

### Savings: **90% reduction on cached runs**

---

## 13. Implementation in CLI

### Step 1: Add KB initialization to cli.js
```javascript
const kb = await loadOrCreateKB(workDir);
// Pass kb to agent orchestrator
```

### Step 2: Pass cached data to agents
```javascript
const context = {
  workDir,
  techStack: kb.techStack,          // Cached or fresh
  codeAnalysis: kb.analysis,        // Cached or fresh
  apiDocumentation: kb.endpoints,   // Cached or fresh
  knowledgeSource: kb.source        // 'cache' or 'fresh'
};
```

### Step 3: Update KB after run
```javascript
await updateKB(workDir, {
  testFilesGenerated,
  testResults,
  newFailures,
  fixes Applied
});
```

---

## 14. Workflow Configuration

### In CORRECT-container-workflow.yml

Add KB persistence across runs:

```yaml
- name: Cache Knowledge Base
  uses: actions/cache@v3
  with:
    path: .ignis-kb
    key: ignis-kb-${{ github.event.inputs.branch }}-${{ hashFiles('package.json', 'src/**') }}
    restore-keys: |
      ignis-kb-${{ github.event.inputs.branch }}-
      ignis-kb-main-
```

This ensures:
- KB persists between workflow runs
- Different branches have separate caches
- Project changes invalidate cache automatically

---

## 15. Monitoring & Metrics

Track KB effectiveness:

```json
{
  "kbMetrics": {
    "cacheHitRate": "85%",
    "tokenSavingPerRun": "~18K tokens",
    "avgRunTimeBefore": "3600s",
    "avgRunTimeAfter": "1800s",
    "monthlyTokenSaved": "432K tokens",
    "monthlyCostSaved": "$1.73 (at $0.004/1K tokens)"
  }
}
```

---

## Summary

| Aspect | Benefit |
|--------|---------|
| **Token Usage** | 90% reduction on cached runs |
| **Speed** | 2-3x faster on subsequent runs |
| **Cost** | $1-2/month savings per project |
| **Maintainability** | Incremental updates instead of full re-analysis |
| **Knowledge Retention** | Cumulative learning across runs |

This system transforms IGNIS from a stateless agent into a stateful, intelligent system that improves with every run while minimizing token consumption and execution time.
