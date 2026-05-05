#!/bin/bash
# Container entrypoint script for IGNIS Automation Test Agent
# Handles --help, --version, and diagnostic flags

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check for help flag
if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
  echo "═══════════════════════════════════════════════════════════════════════════"
  echo "   IGNIS Automation Test Agent v2.0.0"
  echo "   AI-Powered Test Generation and Validation"
  echo "═══════════════════════════════════════════════════════════════════════════"
  echo ""
  echo "USAGE:"
  echo "  docker run [OPTIONS] ignis-test-agent [FLAGS]"
  echo ""
  echo "FLAGS:"
  echo "  --help, -h              Show this help message"
  echo "  --version, -v           Show version information"
  echo "  --diagnose              Run diagnostic checks"
  echo ""
  echo "REQUIRED ENVIRONMENT VARIABLES:"
  echo "  REPO_PATH               Path to repository to test (mounted volume)"
  echo "  AI_API_KEY              API key for AI provider (or provider-specific key)"
  echo ""
  echo "OPTIONAL ENVIRONMENT VARIABLES:"
  echo "  AI_PROVIDER             AI provider (openai|claude|gemini) [default: openai]"
  echo "  REPO_BRANCH             Git branch to use [default: main]"
  echo "  MAX_ITERATIONS          Max fix iterations [default: 3]"
  echo "  TEST_TYPES              Comma-separated test types [default: e2e,api]"
  echo "  AUTO_START_APP          Auto-start application [default: false]"
  echo "  APP_URL                 Application URL if already running"
  echo "  APP_START_COMMAND       Command to start app"
  echo "  LOG_LEVEL               Log level (debug|info|warn|error) [default: info]"
  echo ""
  echo "EXAMPLE:"
  echo "  docker run --rm \\"
  echo "    -v \"\$PWD:/workspace\" \\"
  echo "    -e REPO_PATH=/workspace \\"
  echo "    -e AI_API_KEY=\$OPENAI_API_KEY \\"
  echo "    -e AUTO_START_APP=true \\"
  echo "    ignis-test-agent"
  echo ""
  echo "DOCUMENTATION:"
  echo "  https://github.com/your-org/ignis-test-agent"
  echo ""
  exit 0
fi

# Check for version flag
if [ "$1" == "--version" ] || [ "$1" == "-v" ]; then
  echo "IGNIS Automation Test Agent v2.0.0"
  echo "Node: $(node --version)"
  echo "Playwright: $(npx playwright --version 2>&1 | head -n1)"
  echo "Platform: Linux $(uname -r)"
  exit 0
fi

# Check for diagnose flag
if [ "$1" == "--diagnose" ]; then
  echo "═══════════════════════════════════════════════════════════════════════════"
  echo "   IGNIS Container Diagnostics"
  echo "═══════════════════════════════════════════════════════════════════════════"
  echo ""
  
  echo "📦 CONTAINER ENVIRONMENT"
  echo "────────────────────────────────────────────────────────────────────────────"
  echo "Working Directory: $(pwd)"
  echo "User: $(whoami)"
  echo "Node Version: $(node --version)"
  echo "NPM Version: $(npm --version)"
  echo "Playwright Version: $(npx playwright --version 2>&1 | head -n1)"
  echo ""
  
  echo "📁 DIRECTORY STRUCTURE"
  echo "────────────────────────────────────────────────────────────────────────────"
  ls -la /app 2>&1 | head -n 15
  echo ""
  
  echo "🔍 KEY FILES CHECK"
  echo "────────────────────────────────────────────────────────────────────────────"
  [ -f "/app/src/cli.js" ] && echo "✅ /app/src/cli.js exists" || echo "❌ /app/src/cli.js missing"
  [ -f "/app/package.json" ] && echo "✅ /app/package.json exists" || echo "❌ /app/package.json missing"
  [ -d "/app/node_modules" ] && echo "✅ /app/node_modules exists" || echo "❌ /app/node_modules missing"
  [ -d "/app/workspace" ] && echo "✅ /app/workspace exists" || echo "❌ /app/workspace missing"
  [ -d "/app/logs" ] && echo "✅ /app/logs directory exists" || echo "❌ /app/logs missing"
  echo ""
  
  echo "🔐 ENVIRONMENT VARIABLES CHECK"
  echo "────────────────────────────────────────────────────────────────────────────"
  
  if [ -z "$REPO_PATH" ]; then
    echo "❌ REPO_PATH not set"
  else
    echo "✅ REPO_PATH: $REPO_PATH"
    if [ -d "$REPO_PATH" ]; then
      echo "   ✅ Directory exists"
      echo "   Files: $(ls -1 $REPO_PATH 2>/dev/null | wc -l) items"
    else
      echo "   ❌ Directory does not exist"
    fi
  fi
  
  if [ -z "$AI_API_KEY" ] && [ -z "$OPENAI_API_KEY" ] && [ -z "$CLAUDE_API_KEY" ] && [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ No AI API key found (AI_API_KEY, OPENAI_API_KEY, CLAUDE_API_KEY, or GEMINI_API_KEY)"
  else
    echo "✅ AI API key configured"
  fi
  
  echo "   AI_PROVIDER: ${AI_PROVIDER:-openai}"
  echo "   LOG_LEVEL: ${LOG_LEVEL:-info}"
  echo "   MAX_ITERATIONS: ${MAX_ITERATIONS:-3}"
  echo "   AUTO_START_APP: ${AUTO_START_APP:-false}"
  echo ""
  
  echo "🎭 PLAYWRIGHT BROWSERS"
  echo "────────────────────────────────────────────────────────────────────────────"
  npx playwright --version 2>&1
  echo ""
  
  echo "═══════════════════════════════════════════════════════════════════════════"
  echo "✅ Diagnostics complete"
  echo "═══════════════════════════════════════════════════════════════════════════"
  exit 0
fi

# Default: Run the CLI
echo "🚀 Starting IGNIS Automation Test Agent..."
echo ""

# Verify critical environment
if [ -z "$REPO_PATH" ]; then
  echo "❌ ERROR: REPO_PATH environment variable is required"
  echo "   Please set -e REPO_PATH=/workspace when running the container"
  exit 1
fi

if [ ! -d "$REPO_PATH" ]; then
  echo "❌ ERROR: REPO_PATH directory does not exist: $REPO_PATH"
  echo "   Please ensure the directory is mounted with -v"
  exit 1
fi

if [ -z "$AI_API_KEY" ] && [ -z "$OPENAI_API_KEY" ] && [ -z "$CLAUDE_API_KEY" ] && [ -z "$GEMINI_API_KEY" ]; then
  echo "❌ ERROR: No AI API key found"
  echo "   Please set one of: AI_API_KEY, OPENAI_API_KEY, CLAUDE_API_KEY, GEMINI_API_KEY"
  exit 1
fi

# Set LOG_DIR to workspace so logs are accessible after container exits
export LOG_DIR="${REPO_PATH}/logs"
echo "📝 Logs will be written to: ${LOG_DIR}"
echo ""

# Ensure git identity is configured (safety net)
git config --global user.email "ignis-agent@automated.dev" 2>/dev/null || true
git config --global user.name "IGNIS Automation Agent" 2>/dev/null || true

# Mark workspace as safe directory for git
git config --global --add safe.directory "${REPO_PATH}" 2>/dev/null || true

# Run the CLI
exec node /app/src/cli.js "$@"
