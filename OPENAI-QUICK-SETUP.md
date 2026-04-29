# Quick Setup Guide - OpenAI Configuration

## ⚡ 3-Minute Setup with OpenAI

### Step 1: Get OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Copy the key (starts with `sk-proj-`)

### Step 2: Create `.env` File

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxx
GITHUB_TOKEN=ghp_xxxxxxxxxxxx
```

### Step 3: Run

```bash
npm install
npm run cli
```

## 💰 Cost Estimate

- **Small project:** $0.50 - $2.00 per run
- **Medium project:** $2.00 - $8.00 per run  
- **Large project:** $8.00 - $20.00 per run

## 🔄 Switch Between Providers Anytime

```bash
# Use OpenAI (recommended for quality)
AI_PROVIDER=openai
OPENAI_API_KEY=sk-xxxx

# Use Gemini (cheapest option)
AI_PROVIDER=gemini
GEMINI_API_KEY=AIza-xxxx

# Use Claude (highest quality)
AI_PROVIDER=claude
CLAUDE_API_KEY=sk-ant-xxxx
```

## 📋 Recommended Models

| Provider | Model | Cost | Quality | Speed |
|----------|-------|------|---------|-------|
| OpenAI | `gpt-4o` | 💰💰 | ⭐⭐⭐⭐ | ⚡⚡⚡ |
| OpenAI | `gpt-4-turbo` | 💰💰💰 | ⭐⭐⭐⭐⭐ | ⚡⚡ |
| Gemini | `gemini-1.5-pro` | 💰 | ⭐⭐⭐⭐ | ⚡⚡⚡ |
| Claude | `claude-sonnet-4` | 💰💰 | ⭐⭐⭐⭐⭐ | ⚡⚡ |

**Default if not specified:**
- OpenAI: `gpt-4-turbo`
- Gemini: `gemini-1.5-pro`
- Claude: `claude-sonnet-4-20250514`

## ✅ Verify Setup

```bash
npm run validate
```

Expected output:
```
✓ Node.js: v18.x.x
✓ npm: v9.x.x
✓ AI Provider: openai
✓ AI API Key: Set
✓ GitHub Token: Set
✓ Playwright: Installed
```

## 🚀 GitHub Actions Setup

```yaml
- name: Run IGNIS
  env:
    AI_PROVIDER: openai
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Add secret:** Settings → Secrets → Actions → New repository secret → `OPENAI_API_KEY`

---

For detailed information, see [OPENAI-COMPATIBILITY-ANALYSIS.md](./OPENAI-COMPATIBILITY-ANALYSIS.md)
