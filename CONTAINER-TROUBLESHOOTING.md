# Container Troubleshooting Guide

## Quick Diagnostics

### 1. Run Container Diagnostics
```bash
docker run --rm <your-acr>.azurecr.io/automationtestagent:latest --diagnose
```

This will check:
- ✅ Container environment (Node, Playwright versions)
- ✅ Directory structure
- ✅ Key files existence
- ✅ Environment variables
- ✅ Mounted volumes

### 2. Test Help Command
```bash
docker run --rm <your-acr>.azurecr.io/automationtestagent:latest --help
```

### 3. Check Version
```bash
docker run --rm <your-acr>.azurecr.io/automationtestagent:latest --version
```

---

## Common Issues and Solutions

### ❌ Container exits with code 1 (No error message)

**Symptoms:**
```
Container Exit Code: 1
(no error details shown)
```

**Causes:**
1. Missing AI API key
2. Invalid REPO_PATH (not mounted or doesn't exist)
3. Configuration validation error

**Solution:**
```bash
# Run diagnostics first
docker run --rm \
  -v "$PWD:/workspace" \
  -e REPO_PATH=/workspace \
  -e AI_API_KEY=$OPENAI_API_KEY \
  <your-acr>.azurecr.io/automationtestagent:latest \
  --diagnose

# Check the output for ❌ errors
```

---

### ❌ REPO_PATH not found

**Error:**
```
❌ ERROR: REPO_PATH directory does not exist: /workspace
```

**Solution:**
Ensure volume is mounted correctly:
```bash
docker run --rm \
  -v "$PWD:/workspace" \          # ← Mount current directory
  -e REPO_PATH=/workspace \        # ← Use mounted path
  -e AI_API_KEY=$OPENAI_API_KEY \
  <image>
```

---

### ❌ No AI API key found

**Error:**
```
❌ No AI API key found in environment variables
```

**Solution:**
Set one of these environment variables:
```bash
# Option 1: Generic key (recommended)
-e AI_API_KEY=$OPENAI_API_KEY

# Option 2: Provider-specific
-e OPENAI_API_KEY=$OPENAI_API_KEY
-e CLAUDE_API_KEY=$CLAUDE_API_KEY
-e GEMINI_API_KEY=$GEMINI_API_KEY
```

---

### ❌ Repository path is not a directory

**Error:**
```
❌ Repository path is not a directory: /workspace/myfile.txt
```

**Solution:**
REPO_PATH must point to a **directory**, not a file:
```bash
# ❌ Wrong
-e REPO_PATH=/workspace/package.json

# ✅ Correct
-e REPO_PATH=/workspace
```

---

### ❌ Target app has no package.json

**This is NORMAL!** The target application doesn't need a package.json at the root if it's a monorepo or has package.json elsewhere.

**Example structure:**
```
/workspace/                    ← REPO_PATH (✅ Valid)
  ├── src/                     ← Source code
  │   ├── backend/
  │   │   └── package.json     ← Backend package.json
  │   └── frontend/
  │       └── package.json     ← Frontend package.json
  ├── docs/
  └── README.md
```

The agent will:
1. Scan the entire directory structure
2. Detect technology stacks automatically
3. Find package.json files in subdirectories

---

## GitHub Actions Debugging

### View Container Logs

In your workflow, check these sections:
1. **Container verification** - Shows if container can start
2. **Secrets check** - Confirms API keys are set
3. **Agent run output** - Shows actual agent execution

### Enable Verbose Logging

```yaml
- name: Run IGNIS Agent
  env:
    LOG_LEVEL: debug          # ← Add this
    VERBOSE: "true"           # ← Add this
  run: |
    docker run --rm \
      -e LOG_LEVEL=debug \
      ...
```

### Access Logs via Artifacts

The agent writes logs to these locations:
- `logs/error.log` - Error logs
- `logs/combined.log` - All logs
- `logs/run-summary-*.log` - Execution summary
- `logs/test-results-*.log` - Test results

Upload them as artifacts:
```yaml
- name: Upload Logs
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: ignis-logs
    path: |
      logs/
      test-results/
```

---

## Manual Testing (Local Development)

### Test with test-demo-app

```bash
# From project root
cd devAutomationTestAgent

# Build image
docker build -t ignis-test-agent:local .

# Run with test-demo-app
docker run --rm \
  -v "$PWD/test-demo-app:/workspace" \
  -e REPO_PATH=/workspace \
  -e AI_API_KEY=$OPENAI_API_KEY \
  -e AUTO_START_APP=true \
  -e MAX_ITERATIONS=1 \
  -e TEST_TYPES=api \
  -e LOG_LEVEL=debug \
  ignis-test-agent:local
```

### Test with External Repository

```bash
# Clone your target app
git clone https://github.com/your-org/your-app.git
cd your-app

# Run agent
docker run --rm \
  -v "$PWD:/workspace" \
  -e REPO_PATH=/workspace \
  -e AI_API_KEY=$OPENAI_API_KEY \
  -e AUTO_START_APP=true \
  ignis-test-agent:local
```

---

## Environment Variables Reference

### Required
| Variable | Description | Example |
|----------|-------------|---------|
| `REPO_PATH` | Path to repository | `/workspace` |
| `AI_API_KEY` | AI provider API key | `sk-proj-xxx` |

### Optional
| Variable | Default | Description |
|----------|---------|-------------|
| `AI_PROVIDER` | `openai` | AI provider (openai/claude/gemini) |
| `REPO_BRANCH` | `main` | Git branch to use |
| `MAX_ITERATIONS` | `3` | Max fix iterations |
| `TEST_TYPES` | `e2e,api` | Test types to generate |
| `AUTO_START_APP` | `false` | Auto-start application |
| `APP_URL` | - | App URL if already running |
| `APP_START_COMMAND` | - | Command to start app |
| `LOG_LEVEL` | `info` | Log level (debug/info/warn/error) |
| `VERBOSE` | `false` | Enable verbose output |

---

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | All tests passed | ✅ Success |
| 1 | General error or tests failed | Check logs |
| 125 | Docker daemon error | Check Docker status |
| 126 | Command cannot be invoked | Check entrypoint script |
| 127 | Command not found | Rebuild image |
| 137 | Container killed (OOM) | Increase memory |

---

## Getting Help

1. **Check diagnostics first:**
   ```bash
   docker run --rm <image> --diagnose
   ```

2. **Enable debug logging:**
   ```bash
   -e LOG_LEVEL=debug -e VERBOSE=true
   ```

3. **Check logs directory:**
   - `logs/error.log`
   - `logs/combined.log`
   - `logs/run-summary-*.log`

4. **Review documentation:**
   - [Production Deployment Guide](./PRODUCTION-DEPLOYMENT-GUIDE.md)
   - [GitHub Actions Log Access](./GITHUB-ACTIONS-LOG-ACCESS.md)
   - [Quick Reference](./QUICK-REFERENCE.md)
