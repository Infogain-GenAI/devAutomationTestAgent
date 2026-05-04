# Container Exit Code 1 - Fix Summary

## Issue Description
The IGNIS container was exiting with code 1 in GitHub Actions with no error message visible in logs. The only output was a deprecation warning about `punycode` module.

## Root Causes Identified

### 1. **Missing Error Handler on `main()` Call** ⚠️ CRITICAL
**Location:** `src/cli.js` line 358

**Problem:**
```javascript
main();  // ❌ No .catch() handler
```

Any unhandled errors in the async `main()` function would cause Node.js to exit with code 1 silently.

**Fix:**
```javascript
main().catch(err => {
  console.error('═'.repeat(80));
  console.error('❌ FATAL ERROR - IGNIS Agent Failed to Start');
  console.error('═'.repeat(80));
  console.error(`Error: ${err.message}`);
  console.error(`Stack: ${err.stack}`);
  console.error('═'.repeat(80));
  // ... diagnostic info ...
  process.exit(1);
});
```

---

### 2. **Missing Pre-flight Validation** ⚠️ HIGH PRIORITY
**Location:** `src/cli.js` main() function

**Problem:**
- No early validation of required environment variables
- Errors would occur deep in the code without clear diagnosis

**Fix:**
Added comprehensive pre-flight checks:
```javascript
// Check AI API key
if (!aiApiKey) {
  logger.error('❌ No AI API key found');
  throw new Error('Missing required AI API key');
}

// Validate repository path
if (!fs.existsSync(repoPath)) {
  logger.error(`❌ Repository path does not exist: ${repoPath}`);
  throw new Error(`Repository path not found: ${repoPath}`);
}
```

---

### 3. **Container Doesn't Support `--help` Flag** ⚠️ MEDIUM PRIORITY
**Location:** Dockerfile CMD configuration

**Problem:**
```dockerfile
CMD ["node", "/app/src/cli.js"]  # ❌ No way to pass flags
```

GitHub Actions workflow tried to run `docker run ... --help` which failed with:
```
exec: "--help": executable file not found in $PATH
```

**Fix:**
Created `scripts/container-entrypoint.sh` to handle flags:
- `--help` - Show usage information
- `--version` - Show version info
- `--diagnose` - Run diagnostic checks

Updated Dockerfile:
```dockerfile
ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]
CMD []
```

---

## Files Changed

### 1. `src/cli.js`
**Changes:**
- ✅ Added pre-flight validation for AI API key
- ✅ Added pre-flight validation for REPO_PATH existence
- ✅ Added comprehensive error logging in pre-flight checks
- ✅ Added `.catch()` handler on `main()` call with detailed error output

**Lines Modified:** ~40 lines added

---

### 2. `scripts/container-entrypoint.sh` (NEW)
**Purpose:** Container entrypoint with flag handling and validation

**Features:**
- ✅ `--help` flag - Shows usage documentation
- ✅ `--version` flag - Shows version information
- ✅ `--diagnose` flag - Runs comprehensive diagnostics:
  - Container environment (Node, Playwright versions)
  - Directory structure verification
  - Key files existence checks
  - Environment variables validation
  - Mounted volume verification
- ✅ Pre-execution validation (REPO_PATH, AI_API_KEY)
- ✅ Clear error messages with actionable guidance

**Lines:** ~220 lines

---

### 3. `Dockerfile`
**Changes:**
- ✅ Updated `RUN chmod +x` to include `*.sh` files
- ✅ Changed from `CMD ["node", "/app/src/cli.js"]` to `ENTRYPOINT ["/app/scripts/container-entrypoint.sh"]`
- ✅ Set `CMD []` to allow flag passing

**Lines Modified:** 3 lines

---

### 4. `CONTAINER-TROUBLESHOOTING.md` (NEW)
**Purpose:** Comprehensive troubleshooting guide for container issues

**Sections:**
- Quick diagnostics commands
- Common issues and solutions
- GitHub Actions debugging tips
- Manual testing instructions
- Environment variables reference
- Exit codes explanation

**Lines:** ~400 lines

---

## Testing the Fixes

### Local Testing

```bash
cd devAutomationTestAgent

# 1. Build the updated image
docker build -t ignis-test-agent:fixed .

# 2. Test help flag (should work now!)
docker run --rm ignis-test-agent:fixed --help

# 3. Test version flag
docker run --rm ignis-test-agent:fixed --version

# 4. Test diagnostics
docker run --rm \
  -v "$PWD/test-demo-app:/workspace" \
  -e REPO_PATH=/workspace \
  -e AI_API_KEY=$OPENAI_API_KEY \
  ignis-test-agent:fixed --diagnose

# 5. Run actual agent
docker run --rm \
  -v "$PWD/test-demo-app:/workspace" \
  -e REPO_PATH=/workspace \
  -e AI_API_KEY=$OPENAI_API_KEY \
  -e AUTO_START_APP=true \
  -e MAX_ITERATIONS=1 \
  -e TEST_TYPES=api \
  ignis-test-agent:fixed
```

---

### GitHub Actions Testing

After pushing to ACR, the workflow will now:

1. **Container verification step** - Will succeed with `--help` flag:
```bash
docker run --rm ${FULL_IMAGE} --help  # ✅ Now works!
```

2. **Show better error messages** if something fails:
```
❌ FATAL ERROR - IGNIS Agent Failed to Start
════════════════════════════════════════════════════════════════════════════════
Error: Missing required AI API key
Stack: Error: Missing required AI API key
    at main (/app/src/cli.js:28:11)
    ...
════════════════════════════════════════════════════════════════════════════════

🔍 Common Issues:
  1. Missing required environment variables (AI_API_KEY, REPO_PATH)
  2. Invalid configuration in config files
  3. Network issues connecting to AI provider
  4. Insufficient permissions in workspace directory
```

---

## Expected Improvements

### Before Fixes:
```
Container Exit Code: 1
(no error details)
```

### After Fixes:
```
🚀 Starting IGNIS Automation Test Agent...

❌ ERROR: No AI API key found
   Please set one of: AI_API_KEY, OPENAI_API_KEY, CLAUDE_API_KEY, GEMINI_API_KEY
   
Container Exit Code: 1
```

OR if successful:
```
🚀 Starting IGNIS Automation Test Agent...

13:51:49 [info] IGNIS Automation Test Agent — CLI Mode (Primary)
13:51:49 [info] ================================================
13:51:49 [info] 🔍 Pre-flight checks...
13:51:49 [info] ✅ AI Provider: openai
13:51:49 [info] ✅ AI API Key: sk-proj-xx...
13:51:49 [info] Repository path: /workspace
13:51:49 [info] Base branch: main
...
13:53:25 [info] ✅ All tests passed — exiting with code 0
```

---

## Deployment Checklist

- [x] Update `src/cli.js` with error handling
- [x] Create `scripts/container-entrypoint.sh`
- [x] Update `Dockerfile` to use entrypoint
- [x] Create troubleshooting documentation
- [ ] Test locally with Docker
- [ ] Build and push to ACR
- [ ] Test in GitHub Actions
- [ ] Monitor first production run

---

## Next Steps

1. **Build and push updated image:**
   ```bash
   cd devAutomationTestAgent
   npm run build:production
   ```

2. **Test in GitHub Actions:**
   - Push changes to repository
   - Trigger workflow
   - Check for clear error messages (if any failures occur)
   - Verify `--help` flag works in verification step

3. **Monitor production logs:**
   - Check GitHub Actions artifacts for logs
   - Verify error messages are helpful
   - Confirm diagnostics provide actionable information

---

## Additional Notes

### Punycode Deprecation Warning
The warning `(node:1) [DEP0040] DeprecationWarning: The 'punycode' module is deprecated` is harmless and comes from a dependency. It doesn't affect functionality.

### Health Check Consideration
The current `HEALTHCHECK` is designed for API server mode. For CLI mode in GitHub Actions, it will always fail since no HTTP server is running. This is expected and doesn't affect CLI execution.

---

## Rollback Plan
If issues persist, revert to previous CMD:
```dockerfile
CMD ["node", "/app/src/cli.js"]
```

And remove ENTRYPOINT line. The error handling improvements in cli.js will still provide better diagnostics.
