# Pre-Flight Validation Guide

## 🚀 Why Pre-Flight Checks Are Important

Before running the IGNIS Automation Test Agent, you should **always validate** your setup to avoid:
- ❌ Invalid API keys causing failures mid-run
- ❌ Missing dependencies
- ❌ Configuration errors
- ❌ Wasted time and API costs

## 📋 What Gets Validated

The pre-flight check validates:

### 1. **Environment Variables**
- ✅ `GITHUB_TOKEN` is set
- ✅ `AI_PROVIDER` is valid (openai/claude/gemini)
- ✅ Provider-specific API key is set (`OPENAI_API_KEY`, etc.)

### 2. **Configuration**
- ✅ Configuration loads without errors
- ✅ Schema validation passes
- ✅ All required settings are present

### 3. **Dependencies**
- ✅ All npm packages installed
- ✅ AI provider SDK available
- ✅ Playwright installed

### 4. **AI Provider Connectivity** ⭐ **NEW**
- ✅ **Tests if your OpenAI/Claude/Gemini API key actually works**
- ✅ Verifies authentication
- ✅ Checks model access
- ✅ Detects quota/rate limit issues

### 5. **File Structure**
- ✅ All source files present
- ✅ Configuration files exist

---

## 🎯 How to Use

### **Option 1: Run Pre-Flight Check Only**

```powershell
npm run preflight
```

**Output:**
```
✅ PRE-FLIGHT CHECK PASSED
All checks passed - ready to run the agent!

Log file: logs/preflight-2026-05-04T06-15-30.log
```

### **Option 2: Pre-Flight + Run Agent (Recommended)**

```powershell
npm run test:local
```

This automatically:
1. Runs pre-flight checks first
2. If checks pass → runs the agent
3. If checks fail → stops before running (saves time!)

### **Option 3: Standalone Pre-Flight Script**

```powershell
node scripts/preflight-check.js
```

---

## 📊 Understanding Results

### ✅ Success - All Tests Passed
```
✅ PRE-FLIGHT CHECK PASSED
All checks passed - ready to run the agent!
```
→ **You can proceed** - everything is configured correctly

### ⚠️ Warnings
```
⚠️  PRE-FLIGHT CHECK PASSED WITH WARNINGS
Review warnings above - agent will run but may have issues
```
→ **Proceed with caution** - review warnings first

### ❌ Failure
```
❌ PRE-FLIGHT CHECK FAILED
Please fix the errors above before running the agent
```
→ **Do NOT run the agent** - fix errors first

---

## 🔍 Common Errors & Solutions

### Error: OpenAI API Test FAILED

**Symptoms:**
```
✗ OpenAI API test FAILED: 401 Incorrect API key provided
→ Invalid API key or authentication failed
```

**Solutions:**
1. Check your `.env` file - is `OPENAI_API_KEY` correct?
2. Verify the key hasn't expired
3. Test the key at: https://platform.openai.com/api-keys
4. Regenerate if needed

---

### Error: Rate Limit Exceeded

**Symptoms:**
```
✗ OpenAI API test FAILED: 429 Rate limit exceeded
→ Rate limit exceeded - wait and try again
```

**Solutions:**
1. Wait a few minutes
2. Check your OpenAI usage dashboard
3. Upgrade your tier if needed
4. Reduce `MAX_ITERATIONS` in `.env`

---

### Error: GPT-4 Models Not Found

**Symptoms:**
```
⚠ GPT-4 models not found - check your API tier
```

**Solutions:**
1. Your API key only has access to GPT-3.5
2. Upgrade to GPT-4 access at OpenAI
3. Or change `AI_PROVIDER` to use GPT-3.5-turbo

---

### Error: Missing Dependencies

**Symptoms:**
```
✗ openai - NOT INSTALLED
```

**Solutions:**
```powershell
npm install
```

---

## 📁 Log Files

All pre-flight checks create detailed logs:

**Location:** `logs/preflight-YYYY-MM-DDTHH-MM-SS.log`

**Contains:**
- Timestamp of each check
- Detailed error messages
- API response information
- Configuration values (sanitized)

**View the log:**
```powershell
cat logs\preflight-*.log | Select-Object -Last 50
```

---

## 🎬 Complete Workflow

### **Before First Run:**

```powershell
# 1. Setup environment
cp .env.example .env
# Edit .env with your API keys

# 2. Install dependencies
npm run setup

# 3. Validate configuration
npm run validate

# 4. Pre-flight check (tests API key!)
npm run preflight
```

### **For Each Test Run:**

```powershell
# Quick pre-flight + run
npm run test:local
```

---

## 🆚 Validation vs Pre-Flight vs Diagnostics

| Script | Purpose | When to Use |
|--------|---------|-------------|
| **validate-setup.js** | Checks local file structure & config | Initial setup |
| **preflight-check.js** ⭐ | Tests API connectivity & validates keys | Before each run |
| **diagnose-container.js** | Container path debugging | Production issues |

**Use preflight-check.js to ensure your OpenAI key works BEFORE running the agent!**

---

## 🔐 Security Note

Pre-flight checks **never log your API keys** - they only test if they work.

Log files contain:
- ✅ Timestamps and results
- ✅ Error messages
- ✅ Configuration structure
- ❌ **NO API keys or secrets**

---

## 💡 Pro Tips

1. **Always run pre-flight before long test runs** - catches issues early
2. **Check logs if pre-flight fails** - detailed error info
3. **Test in CI/CD** - add `npm run preflight` to your pipeline
4. **Monitor API usage** - pre-flight uses minimal tokens (~$0.001)

---

## 🎯 Next Steps

After successful pre-flight:
- ✅ Run local tests: `npm run test:local`
- ✅ Deploy to container: Build & push Docker image
- ✅ Test in GitHub Actions: Push to repo with workflow

**Your OpenAI key is validated and ready!** 🚀
