# IGNIS Test Agent - Deployment Guide

## Overview

The IGNIS Automation Test Agent is now enhanced with comprehensive backend validation, best practices checking, and automated report generation. This guide covers deployment as a container application.

## Prerequisites

- Docker or container runtime (Azure Container Apps, AWS ECS, GKE, etc.)
- GitHub repository with GitHub Actions enabled
- AI Provider API key (Claude, OpenAI, or Gemini)
- GitHub Personal Access Token or GitHub App credentials

## Features

### Core Capabilities

1. **Complete Repository Analysis**
   - Reads all repository contents from configured branch
   - Analyzes frontend and backend code structure
   - Identifies endpoints, routes, and components

2. **Backend Endpoint Validation**
   - Validates all backend API endpoints
   - Checks for security vulnerabilities:
     - SQL injection
     - XSS vulnerabilities
     - Authentication/authorization issues
     - Input validation
     - CSRF protection
   - Identifies performance concerns
   - Verifies error handling

3. **Best Practices Enforcement**
   - RESTful API design principles
   - Code quality metrics
   - Naming conventions
   - Separation of concerns
   - Database query optimization
   - Memory leak detection

4. **Automated Test Generation**
   - E2E tests using Playwright
   - API tests
   - Visual regression tests
   - Accessibility tests
   - Performance tests

5. **Auto-Fix with PR Creation**
   - Automatically fixes identified issues
   - Creates pull requests with fixes
   - Separate PRs for backend fixes and test additions
   - Includes detailed explanations

6. **Comprehensive Reporting**
   - Markdown report with timestamp
   - Complete analysis findings
   - Root cause analysis (RCA)
   - Severity categorization
   - Recommendations
   - Test results summary

## Configuration

### Environment Variables

Create a `.env` file or configure these in your container environment:

```bash
# ── GitHub Authentication ─────────────────
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ── AI Provider ───────────────────────────
AI_PROVIDER=claude
CLAUDE_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxx

# ── Agent Configuration ──────────────────
REPO_BRANCH=main                         # Branch to analyze
FIX_BRANCH_PREFIX=ignis/fix              # Prefix for fix branches
MAX_ITERATIONS=3                         # Max test-fix iterations
TEST_TYPES=e2e,api,visual,accessibility,performance

# ── Backend Validation ───────────────────
ENABLE_BACKEND_VALIDATION=true           # Enable endpoint validation
ENABLE_BEST_PRACTICES_CHECK=true         # Check best practices
ENABLE_ENDPOINT_VALIDATION=true          # Validate endpoints
ANALYSIS_PROMPT_FILE=config/analysis-prompts.json

# ── Reporting ────────────────────────────
GENERATE_ANALYSIS_REPORT=true            # Generate comprehensive report
REPORT_OUTPUT_DIR=reports                # Report output directory

# ── Application ──────────────────────────
AUTO_START_APP=true                      # Auto-start the target app
APP_URL=http://localhost:3000            # App URL (if not auto-started)
```

### Analysis Prompts Configuration

The agent uses `config/analysis-prompts.json` to configure validation rules. This file contains:

- Backend validation checks
- Best practices rules
- Security audit criteria
- Performance analysis areas
- Report structure templates

You can customize this file to add project-specific validation rules.

## Deployment Options

### Option 1: Docker Container

```bash
# Build the image
docker build -t ignis-test-agent:latest .

# Run the container
docker run -d \
  -p 4000:4000 \
  -e GITHUB_TOKEN=your_token \
  -e CLAUDE_API_KEY=your_key \
  -e ENABLE_BACKEND_VALIDATION=true \
  -e GENERATE_ANALYSIS_REPORT=true \
  --name ignis-agent \
  ignis-test-agent:latest
```

### Option 2: Azure Container Apps

```bash
# Create resource group
az group create --name ignis-rg --location eastus

# Create container app environment
az containerapp env create \
  --name ignis-env \
  --resource-group ignis-rg \
  --location eastus

# Deploy container app
az containerapp create \
  --name ignis-test-agent \
  --resource-group ignis-rg \
  --environment ignis-env \
  --image your-registry/ignis-test-agent:latest \
  --target-port 4000 \
  --ingress external \
  --env-vars \
    GITHUB_TOKEN=secretref:github-token \
    CLAUDE_API_KEY=secretref:claude-key \
    ENABLE_BACKEND_VALIDATION=true \
    GENERATE_ANALYSIS_REPORT=true
```

### Option 3: Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ignis-test-agent
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ignis-test-agent
  template:
    metadata:
      labels:
        app: ignis-test-agent
    spec:
      containers:
      - name: ignis-agent
        image: your-registry/ignis-test-agent:latest
        ports:
        - containerPort: 4000
        env:
        - name: GITHUB_TOKEN
          valueFrom:
            secretKeyRef:
              name: ignis-secrets
              key: github-token
        - name: CLAUDE_API_KEY
          valueFrom:
            secretKeyRef:
              name: ignis-secrets
              key: claude-key
        - name: ENABLE_BACKEND_VALIDATION
          value: "true"
        - name: GENERATE_ANALYSIS_REPORT
          value: "true"
```

## GitHub Actions Setup

### 1. Create Workflow File

Create `.github/workflows/ignis-automated-testing.yml` in your repository:

```yaml
name: IGNIS Automated Testing

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:     # Manual trigger

jobs:
  test:
    uses: your-org/ignis-test-agent/.github/workflows/ignis-testing.yml@main
    with:
      branch: ${{ github.ref_name }}
      ai-provider: claude
      max-iterations: 3
      auto-start-app: true
      enable-backend-validation: true
      enable-best-practices: true
      generate-report: true
    secrets:
      ai-api-key: ${{ secrets.CLAUDE_API_KEY }}
```

### 2. Configure Secrets

In your GitHub repository settings, add these secrets:
- `CLAUDE_API_KEY` (or `OPENAI_API_KEY`, `GEMINI_API_KEY`)
- `APP_SECRETS` (JSON object with app-specific secrets, optional)

### 3. Grant Permissions

Ensure the workflow has these permissions:
```yaml
permissions:
  contents: write        # To create branches and commits
  pull-requests: write   # To create PRs
```

## Workflow

The agent follows this workflow:

1. **Repository Checkout**
   - Clones configured branch from GitHub
   - Creates a fix branch for changes

2. **Dependency Installation**
   - Installs project dependencies
   - Installs Playwright browsers

3. **Environment Setup**
   - Resolves environment variables
   - Auto-generates missing secrets

4. **Code Analysis**
   - Structure scan (file tree, stats)
   - Surface analysis (routes, endpoints, components)
   - Deep analysis with AI

5. **Backend Validation** ⭐ NEW
   - Validates all backend endpoints
   - Checks security vulnerabilities
   - Identifies best practice violations
   - Generates fixes for critical issues

6. **Test Generation**
   - Generates E2E, API, Visual, A11y, Performance tests
   - Creates Playwright configuration

7. **Test Execution**
   - Runs all generated tests
   - Categorizes failures

8. **Auto-Fix Iterations**
   - Analyzes test failures
   - Generates fixes using AI
   - Validates fixes incrementally
   - Commits validated changes

9. **Report Generation** ⭐ NEW
   - Creates comprehensive markdown report
   - Includes RCA and recommendations
   - Adds timestamp and metadata

10. **Pull Request Creation**
    - Creates PR with all fixes
    - Includes detailed summary
    - Links to generated report

## Report Structure

The generated report includes:

### Executive Summary
- Status overview
- Issue counts by severity
- Test success rate
- Execution time

### Analysis Overview
- Files analyzed
- Endpoints validated
- Configuration details

### Backend Validation Results
- Endpoint issues
- Security vulnerabilities
- Performance concerns

### Best Practices Validation
- Code quality issues
- Violations by file

### Security Analysis
- Critical security issues
- Remediation steps

### Performance Analysis
- Bottlenecks identified
- Optimization opportunities

### Test Results
- Detailed test execution table
- Failed tests with errors

### Fixes Applied
- Application code fixes
- Test code fixes
- Reverted fixes (if any)

### Root Cause Analysis
- Identified root causes
- Impact assessment
- Resolution strategies

### Recommendations
- Immediate actions
- Short-term improvements
- Long-term enhancements

## Monitoring and Debugging

### Logs

Logs are available in the `logs/` directory:
```bash
# View logs in Docker
docker logs ignis-agent

# View logs in Kubernetes
kubectl logs deployment/ignis-test-agent

# Access log files
logs/ignis-agent-YYYY-MM-DD.log
```

### Reports

Reports are generated in the configured directory:
```bash
reports/analysis-report-YYYY-MM-DDTHH-MM-SS.md
reports/analysis-report-YYYY-MM-DDTHH-MM-SS.json
```

### Artifacts

GitHub Actions uploads these artifacts:
- `generated-tests/` - All generated test files
- `test-results/` - Test execution results
- `playwright-report/` - HTML test report
- `reports/` - Analysis reports
- `logs/` - Execution logs

## Troubleshooting

### Issue: Backend validation not running

**Solution**: Ensure `ENABLE_BACKEND_VALIDATION=true` is set.

### Issue: No fixes are applied

**Solution**: 
- Check AI provider configuration
- Verify API key is valid
- Review logs for AI API errors

### Issue: Tests not generating

**Solution**:
- Ensure code analysis completed successfully
- Check `generated-tests/` directory
- Review logs for generation errors

### Issue: PR creation fails

**Solution**:
- Verify `GITHUB_TOKEN` has correct permissions
- Check repository settings for branch protection
- Ensure workflow has `contents: write` permission

## Best Practices

1. **Start with a Test Run**
   - Run manually first to verify configuration
   - Review generated tests before enabling auto-PR

2. **Customize Validation Rules**
   - Edit `config/analysis-prompts.json` for project needs
   - Add project-specific security checks

3. **Monitor AI Costs**
   - Set appropriate `MAX_ITERATIONS`
   - Limit test types if needed
   - Use caching where available

4. **Review Reports Regularly**
   - Track improvements over time
   - Address high-priority issues first
   - Use RCA to prevent recurring issues

5. **Secure Secrets**
   - Never commit `.env` files
   - Use GitHub Secrets or Azure Key Vault
   - Rotate API keys regularly

## Support

For issues or questions:
- Check logs: `logs/ignis-agent-*.log`
- Review reports: `reports/analysis-report-*.md`
- GitHub Issues: Create an issue in the agent repository

## License

MIT License - See LICENSE file for details
