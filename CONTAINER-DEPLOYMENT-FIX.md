# Container Deployment - Troubleshooting Guide

## 🔴 Common Error: Exit Code 1

### Error Message:
```
🚀 Starting IGNIS Automation Test Agent...
(node:1) [DEP0040] DeprecationWarning: The `punycode` module is deprecated...
Error: Process completed with exit code 1.
```

---

## ✅ Solution: Fix Your Workflow File

### ❌ WRONG Configuration (Your Current Setup):

```yaml
docker run --rm \
  -v "${{ github.workspace }}:/workspace" \
  -w /workspace \  # ❌ Sets working directory to test repo
  -e REPO_PATH="${{ github.workspace }}" \  # ❌ Host path, not container path
  -e AI_PROVIDER="openai" \
  "${FULL_IMAGE}"
```

**Why This Fails:**
1. `-w /workspace` changes working directory from `/app` to `/workspace`
2. Container expects to run from `/app` where the agent code is
3. `REPO_PATH` uses host path instead of container path
4. Node.js can't find modules because working directory is wrong

---

### ✅ CORRECT Configuration:

```yaml
docker run --rm \
  -v "${{ github.workspace }}:/workspace" \
  # ✅ No -w flag - uses WORKDIR /app from Dockerfile
  -e REPO_PATH="/workspace" \  # ✅ Container path
  -e GITHUB_WORKSPACE="/workspace" \  # ✅ Added
  -e AI_PROVIDER="openai" \
  "${FULL_IMAGE}"
```

**Use the complete corrected workflow from:** [`.github/workflows/CORRECT-container-workflow.yml`](CORRECT-container-workflow.yml)

---

## 🔍 Diagnostic Steps

### Step 1: Test with Diagnostic Script

Before running the full agent, test your container setup:

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  -e REPO_PATH="/workspace" \
  -e GITHUB_WORKSPACE="/workspace" \
  your-acr.azurecr.io/automationtestagent:latest_v0 \
  node /app/scripts/diagnose-container.js
```

This will show you:
- ✅ Working directory
- ✅ Environment variables
- ✅ File system paths
- ✅ Module availability
- ✅ Configuration loading

### Step 2: Check Container Structure

```bash
docker run --rm \
  your-acr.azurecr.io/automationtestagent:latest_v0 \
  ls -la /app
```

Expected output:
```
drwxr-xr-x  config/
drwxr-xr-x  logs/
drwxr-xr-x  node_modules/
drwxr-xr-x  reports/
drwxr-xr-x  scripts/
drwxr-xr-x  src/
drwxr-xr-x  workspace/
-rw-r--r--  action.yml
-rw-r--r--  package.json
```

### Step 3: Test CLI Entry Point

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  -e REPO_PATH="/workspace" \
  -e GITHUB_WORKSPACE="/workspace" \
  -e AI_PROVIDER="openai" \
  -e OPENAI_API_KEY="your-key" \
  -e GITHUB_TOKEN="your-token" \
  your-acr.azurecr.io/automationtestagent:latest_v0 \
  node /app/src/cli.js --help
```

---

## 📁 Container Path Structure

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `${{ github.workspace }}` | `/workspace` | Your test repository (mounted) |
| N/A | `/app` | IGNIS agent code (from image) |
| N/A | `/app/src/cli.js` | Entry point |
| N/A | `/app/config/` | Agent configuration |
| N/A | `/app/workspace/` | Agent's work directory |

**Key Point:** The container runs from `/app`, not `/workspace`!

---

## 🔧 Rebuild Container After Fixes

1. **Update Dockerfile** (already done)
   - Entry point changed to `/app/src/cli.js`
   - Added proper environment variables
   - Fixed permissions

2. **Rebuild image:**
   ```bash
   docker build -t your-acr.azurecr.io/automationtestagent:latest_v0 .
   ```

3. **Push to ACR:**
   ```bash
   docker push your-acr.azurecr.io/automationtestagent:latest_v0
   ```

4. **Update your test repository's workflow:**
   - Use the corrected workflow from `CORRECT-container-workflow.yml`
   - Remove `-w /workspace`
   - Change `REPO_PATH` to `/workspace`
   - Add `GITHUB_WORKSPACE="/workspace"`

---

## ✅ Verification Checklist

After applying fixes, verify:

- [ ] Container builds successfully
- [ ] Diagnostic script runs without errors
- [ ] `ls /app` shows expected structure
- [ ] CLI entry point is accessible
- [ ] Workflow uses container paths (not host paths)
- [ ] No `-w /workspace` flag in docker run
- [ ] `REPO_PATH="/workspace"` (container path)
- [ ] `GITHUB_WORKSPACE="/workspace"` is set

---

## 🆘 Still Having Issues?

### Enable Debug Logging:

Add to your docker run command:
```yaml
-e LOG_LEVEL="debug" \
-e NODE_OPTIONS="--trace-warnings" \
```

### Capture Full Logs:

Use this pattern in your workflow:
```yaml
CONTAINER_ID=$(docker run -d ... "${FULL_IMAGE}")
docker logs -f "${CONTAINER_ID}"
EXIT_CODE=$(docker inspect "${CONTAINER_ID}" --format='{{.State.ExitCode}}')
docker rm "${CONTAINER_ID}"
exit ${EXIT_CODE}
```

This ensures you see all error output.

---

## 📚 Related Files

- [Dockerfile](../Dockerfile) - Container image definition
- [CORRECT-container-workflow.yml](CORRECT-container-workflow.yml) - Fixed workflow
- [scripts/diagnose-container.js](../scripts/diagnose-container.js) - Diagnostic tool
- [src/cli.js](../src/cli.js) - Entry point

---

## 🎯 Summary

**The Fix:**
1. Remove `-w /workspace` from docker run
2. Change `REPO_PATH` to `/workspace` (not host path)
3. Add `GITHUB_WORKSPACE="/workspace"`
4. Rebuild and push container
5. Update workflow in test repository

**The container must run from `/app` where the agent code is located!**
