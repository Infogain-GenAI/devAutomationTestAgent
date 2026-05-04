# Container Diagnostics - Purpose & Usage

## 🎯 Why This Script Exists

The `diagnose-container.js` script was created to solve **path resolution issues** in containerized deployments.

### Problem It Solves:

When running in Docker containers, common issues occur:
- ❌ Module not found errors (`Cannot find module '/workspace/src/index.js'`)
- ❌ Wrong working directory (running from `/workspace` instead of `/app`)
- ❌ Missing files (config files, node_modules not accessible)
- ❌ Path confusion between host paths and container paths

### What It Does:

The diagnostic script **validates the container environment** before running the actual agent:

1. ✅ Verifies working directory is correct (`/app`)
2. ✅ Checks all environment variables are set
3. ✅ Validates file system structure (agent code, test repo)
4. ✅ Confirms Node.js modules are accessible
5. ✅ Tests configuration loading
6. ✅ Reports any path mismatches

### When to Use:

**Before deploying to production**, run diagnostics to catch issues:

```bash
# Test your container setup
docker run --rm \
  -v "${{ github.workspace }}:/workspace" \
  -e REPO_PATH="/workspace" \
  -e GITHUB_WORKSPACE="/workspace" \
  your-acr.azurecr.io/automationtestagent:latest \
  node /app/scripts/diagnose-container.js
```

**Expected Output:**
```
✓ Working directory: /app
✓ REPO_PATH: /workspace
✓ File system checks passed
✓ All modules found
✓ Configuration loaded successfully
```

If diagnostics fail, **do not run the agent** - fix the container/workflow first!

---

## 🔍 How It Helped

This script identified the exact issue causing your production error:
- Container was using `-w /workspace` (wrong working directory)
- REPO_PATH was set to host path instead of container path
- Result: Node couldn't find modules because working directory was wrong

After running diagnostics, we found and fixed these issues in your workflow.

---

## 📖 Related Documentation

- [CONTAINER-DEPLOYMENT-FIX.md](../CONTAINER-DEPLOYMENT-FIX.md) - Complete troubleshooting guide
- [Dockerfile](../Dockerfile) - Container configuration
- [CORRECT-container-workflow.yml](../.github/workflows/CORRECT-container-workflow.yml) - Fixed workflow example
