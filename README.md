# IGNIS Automation Test Agent

> AI-powered automation testing agent that generates comprehensive Playwright test suites, executes tests, auto-fixes issues, and creates PRs — fully autonomous, zero user intervention.

## 🎯 Purpose

The IGNIS Automation Test Agent is an intelligent, fully-automated testing solution designed to:

- **Analyze** entire codebases automatically using AI
- **Validate** backend endpoints for security vulnerabilities and best practices
- **Generate** comprehensive test suites (E2E, API, Visual, Accessibility, Performance)
- **Execute** tests with automatic application startup
- **Fix** issues in both application code and test code
- **Create** Pull Requests with detailed reports and fixes
- **Report** comprehensive analysis with RCA, security audits, and recommendations

### Key Benefits

✅ **Zero Manual Intervention** — Fully autonomous from code analysis to PR creation  
✅ **Multi-Language Support** — Works with Node.js, Python, Java, PHP, Ruby, and more  
✅ **Security First** — Detects SQL injection, XSS, CSRF, and authentication issues  
✅ **Best Practices** — Enforces code quality, RESTful design, and architectural patterns  
✅ **Iterative Fixing** — Auto-fixes failing tests up to configurable max iterations  
✅ **Comprehensive Reports** — Markdown reports with executive summaries and RCA  

## ✨ Features (v2.0)

### 🔒 Backend Endpoint Validation
- **Security Analysis**: SQL injection, XSS, CSRF vulnerability detection
- **Authentication Checks**: Validates auth/authorization mechanisms
- **Input Validation**: Ensures proper data sanitization
- **Performance Review**: Database query optimization identification
- **Auto-Fix**: Generates and applies fixes for critical issues

### 📋 Best Practices Enforcement
- **RESTful Design**: API design principle validation
- **Code Quality**: Complexity, duplication, naming convention checks
- **Error Handling**: Comprehensive error management validation
- **Security Patterns**: Secure coding practices validation
- **Architecture**: Separation of concerns, dependency injection reviews

### 📊 Comprehensive Reporting
- **Executive Summary**: High-level overview with severity breakdown
- **Root Cause Analysis**: Identifies underlying issues
- **Security Audit**: Detailed vulnerability assessment
- **Performance Analysis**: Bottleneck identification and optimization
- **Timestamped Reports**: Markdown and JSON formats

### 🤖 Enhanced Automation
- **Full Repository Analysis**: Analyzes entire codebase
- **Multi-Stage Validation**: Backend → Frontend → Tests
- **Automated PR Creation**: Separate PRs for backend fixes and test additions
- **Configurable Rules**: Customizable via `config/analysis-prompts.json`

## 📋 Table of Contents

- [Installation](#-installation)
  - [Prerequisites](#prerequisites)
  - [Local Installation](#local-installation)
  - [Docker Installation](#docker-installation)
- [Configuration](#-configuration)
  - [Environment Variables](#environment-variables)
  - [Configuration Files](#configuration-files)
- [Deployment](#-deployment)
  - [Local Deployment](#local-deployment)
  - [Production Deployment](#production-deployment)
- [Running the Application](#-running-the-application)
  - [GitHub Actions (Primary)](#github-actions-primary)
  - [CLI Mode](#cli-mode)
  - [API Server Mode](#api-server-mode)
- [Usage Examples](#-usage-examples)
- [Architecture](#-architecture)
- [Documentation](#-documentation)

---

## 🚀 Installation

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** or **yarn** or **pnpm**
- **Git**
- **Docker** (optional, for containerized deployment)
- **GitHub Personal Access Token** or **GitHub App credentials**
- **AI Provider API Key** (Claude, OpenAI, or Gemini)

### Local Installation

```bash
# 1. Clone the repository
git clone https://github.com/<org>/ignis-test-agent.git
cd ignis-test-agent

# 2. Install dependencies
npm install

# 3. Install Playwright browsers
npx playwright install --with-deps chromium

# 4. Create environment configuration
cp .env.example .env

# 5. Edit .env with your credentials
# Add your GITHUB_TOKEN, AI_API_KEY, and other required variables

# 6. Validate setup
npm run validate

# 7. Test the installation
npm test
```

### Docker Installation

```bash
# 1. Clone the repository
git clone https://github.com/<org>/ignis-test-agent.git
cd ignis-test-agent

# 2. Build Docker image
docker build -t ignis-test-agent:latest .

# 3. Create .env file
cp .env.example .env
# Edit .env with your credentials

# 4. Run container
docker run -d \
  -p 4000:4000 \
  --env-file .env \
  --name ignis-agent \
  ignis-test-agent:latest
```

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the root directory with the following variables:

#### 🔐 Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_TOKEN` | GitHub Personal Access Token with repo access | `ghp_xxxxxxxxxxxx` |
| `AI_API_KEY` | Universal AI provider API key (or use provider-specific) | `sk-ant-xxxx` |
| `AI_PROVIDER` | AI provider to use: `claude`, `openai`, or `gemini` | `claude` |

#### 🤖 AI Provider Specific (Optional - use instead of AI_API_KEY)

| Variable | Description | Example |
|----------|-------------|---------|
| `CLAUDE_API_KEY` | Anthropic Claude API key | `sk-ant-xxxxxxxxxxxx` |
| `OPENAI_API_KEY` | OpenAI API key | `sk-xxxxxxxxxxxx` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIzaxxxxxxxxxxxx` |

#### 🔧 Agent Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_ITERATIONS` | `3` | Maximum fix-and-retest cycles before stopping |
| `TEST_TYPES` | `e2e,api,visual,accessibility,performance` | Comma-separated test types to generate |
| `REPO_BRANCH` | `main` | Default branch to analyze and create PRs against |
| `FIX_BRANCH_PREFIX` | `ignis/fix` | Prefix for branches created with fixes |
| `ENABLE_BACKEND_VALIDATION` | `true` | Enable backend endpoint security validation |
| `ENABLE_BEST_PRACTICES_CHECK` | `true` | Enable code quality and best practices checking |
| `ENABLE_ENDPOINT_VALIDATION` | `true` | Enable API endpoint validation |
| `GENERATE_ANALYSIS_REPORT` | `true` | Generate comprehensive analysis reports |
| `REPORT_OUTPUT_DIR` | `reports` | Directory for generated reports |
| `ANALYSIS_PROMPT_FILE` | `config/analysis-prompts.json` | Path to validation rules configuration |

#### 🎯 Target Application

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTO_START_APP` | `true` | Automatically start target application from repository |
| `APP_URL` | `null` | URL if app is already running (skips auto-start) |
| `APP_START_COMMAND` | `null` | Custom command to start application (auto-detected if not set) |
| `APP_PORT` | `null` | Port where application will run (auto-detected if not set) |
| `APP_SECRETS` | `{}` | JSON string of environment variables needed by target app |

#### 🗄️ Database (API Server Mode - Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | PostgreSQL database host |
| `POSTGRES_PORT` | `5432` | PostgreSQL database port |
| `POSTGRES_DB` | `ignis_agent` | Database name |
| `POSTGRES_USER` | `postgres` | Database username |
| `POSTGRES_PASSWORD` | `""` | Database password |

#### 🌐 API Server (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Port for API server |
| `NODE_ENV` | `production` | Node environment (`development` or `production`) |

#### 📝 Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `LOG_DIR` | `logs` | Directory for log files |

#### 🔑 GitHub App Authentication (Alternative to PAT)

| Variable | Description | Example |
|----------|-------------|---------|
| `GITHUB_AUTH_METHOD` | Authentication method: `pat` or `app` | `app` |
| `GITHUB_APP_ID` | GitHub App ID | `123456` |
| `GITHUB_PRIVATE_KEY` | GitHub App private key (PEM format) | `-----BEGIN RSA...` |
| `GITHUB_INSTALLATION_ID` | GitHub App installation ID | `789012` |

### Configuration Files

#### `config/analysis-prompts.json`

Defines validation rules and prompts for:
- Backend endpoint security checks (17 checks)
- Best practices rules (17 rules)
- Code quality metrics (12 metrics)
- Frontend validation checks (15 checks)
- Security audit criteria
- Performance analysis areas

You can customize this file to add project-specific validation rules.

#### `config/agent-config.example.json`

Example configuration for advanced agent customization. Copy to `config/agent-config.json` and modify as needed.

---

## 🚢 Deployment

### Local Deployment

#### 1. API Server Mode (Standalone)

Run as a REST API server for programmatic access:

```bash
# Start API server
npm start

# Server will run on http://localhost:4000
```

**API Endpoints:**
- `GET /health` - Health check
- `POST /agent/run` - Start a new test run
- `GET /agent/runs` - List all runs
- `GET /agent/runs/:id` - Get run status
- `POST /agent/runs/:id/stop` - Stop a run

#### 2. CLI Mode (Local Testing)

Run directly against a local repository:

```bash
# Navigate to your target repository
cd /path/to/your/project

# Run IGNIS agent
npx ignis

# Or with custom path
node /path/to/ignis-test-agent/src/cli.js
```

### Production Deployment

#### Option 1: Docker Container

```bash
# Build production image
docker build -t ignis-test-agent:v2.0 .

# Run in production
docker run -d \
  -p 4000:4000 \
  -e GITHUB_TOKEN=ghp_xxx \
  -e CLAUDE_API_KEY=sk-ant-xxx \
  -e LOG_LEVEL=warn \
  -e NODE_ENV=production \
  --restart unless-stopped \
  --name ignis-prod \
  ignis-test-agent:v2.0

# View logs
docker logs -f ignis-prod
```

#### Option 2: Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  ignis-agent:
    build: .
    ports:
      - "4000:4000"
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - CLAUDE_API_KEY=${CLAUDE_API_KEY}
      - NODE_ENV=production
      - LOG_LEVEL=info
      - POSTGRES_HOST=postgres
      - POSTGRES_DB=ignis_agent
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    depends_on:
      - postgres
    restart: unless-stopped
    volumes:
      - ./logs:/app/logs
      - ./reports:/app/reports

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=ignis_agent
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  postgres_data:
```

Deploy:

```bash
docker-compose up -d
```

#### Option 3: Azure Container Apps

```bash
# Login to Azure
az login

# Create resource group
az group create --name ignis-rg --location eastus

# Create container registry
az acr create --resource-group ignis-rg --name ignisregistry --sku Basic

# Build and push image
az acr build --registry ignisregistry --image ignis-test-agent:v2.0 .

# Create container app environment
az containerapp env create \
  --name ignis-env \
  --resource-group ignis-rg \
  --location eastus

# Create secrets
az containerapp secret set \
  --name ignis-test-agent \
  --resource-group ignis-rg \
  --secrets \
    github-token=${GITHUB_TOKEN} \
    claude-key=${CLAUDE_API_KEY}

# Deploy container app
az containerapp create \
  --name ignis-test-agent \
  --resource-group ignis-rg \
  --environment ignis-env \
  --image ignisregistry.azurecr.io/ignis-test-agent:v2.0 \
  --target-port 4000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 5 \
  --cpu 2.0 \
  --memory 4.0Gi \
  --env-vars \
    NODE_ENV=production \
    LOG_LEVEL=info \
  --secrets \
    GITHUB_TOKEN=secretref:github-token \
    CLAUDE_API_KEY=secretref:claude-key
```

#### Option 4: Kubernetes

Create `k8s-deployment.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ignis

---
apiVersion: v1
kind: Secret
metadata:
  name: ignis-secrets
  namespace: ignis
type: Opaque
stringData:
  github-token: "YOUR_GITHUB_TOKEN"
  claude-key: "YOUR_CLAUDE_KEY"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ignis-test-agent
  namespace: ignis
spec:
  replicas: 2
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
        image: your-registry/ignis-test-agent:v2.0
        ports:
        - containerPort: 4000
        env:
        - name: NODE_ENV
          value: "production"
        - name: LOG_LEVEL
          value: "info"
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
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 5
          periodSeconds: 5

---
apiVersion: v1
kind: Service
metadata:
  name: ignis-service
  namespace: ignis
spec:
  selector:
    app: ignis-test-agent
  ports:
  - protocol: TCP
    port: 80
    targetPort: 4000
  type: LoadBalancer
```

Deploy:

```bash
kubectl apply -f k8s-deployment.yaml
kubectl get pods -n ignis
kubectl logs -f -n ignis -l app=ignis-test-agent
```

---

## 🏃 Running the Application

### GitHub Actions (Primary)

This is the **recommended** way to use IGNIS. Add this workflow to your repository:

**Step 1:** Create `.github/workflows/ignis-testing.yml` in your repository:

```yaml
name: IGNIS Automated Testing

on:
  push:
    branches: [main, develop]
  pull_request:
  workflow_dispatch:
    inputs:
      branch:
        description: 'Branch to test'
        default: 'main'

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.branch || github.ref }}
      
      - name: Checkout IGNIS Agent
        uses: actions/checkout@v4
        with:
          repository: your-org/ignis-test-agent
          path: .ignis-agent
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install IGNIS dependencies
        run: npm ci
        working-directory: .ignis-agent
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
        working-directory: .ignis-agent
      
      - name: Run IGNIS Test Agent
        run: node src/cli.js
        working-directory: .ignis-agent
        env:
          REPO_PATH: ${{ github.workspace }}
          REPO_BRANCH: ${{ inputs.branch || github.ref_name }}
          AI_PROVIDER: claude
          CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          MAX_ITERATIONS: 3
          TEST_TYPES: e2e,api,visual,accessibility,performance
          AUTO_START_APP: true
          ENABLE_BACKEND_VALIDATION: true
          ENABLE_BEST_PRACTICES_CHECK: true
          GENERATE_ANALYSIS_REPORT: true
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ignis-results
          path: |
            test-results/
            reports/
            generated-tests/
            logs/
```

**Step 2:** Add secrets to your repository:
- Go to **Settings → Secrets and variables → Actions**
- Add `CLAUDE_API_KEY` (or `OPENAI_API_KEY` or `GEMINI_API_KEY`)

**Step 3:** Trigger the workflow:
- Push to main/develop branch, or
- Create a pull request, or
- Manually run via **Actions → IGNIS Automated Testing → Run workflow**

**The agent will:**
1. ✅ Check out your code
2. ✅ Install dependencies automatically
3. ✅ Detect your tech stack
4. ✅ Validate backend endpoints for security
5. ✅ Check best practices
6. ✅ Generate fixes for critical issues
7. ✅ Analyze your codebase using AI
8. ✅ Generate Playwright test suites
9. ✅ Auto-start your application
10. ✅ Run the tests
11. ✅ Fix any issues iteratively
12. ✅ Generate comprehensive report with RCA
13. ✅ Create PR with fixes + full test report

### CLI Mode

Run the agent directly from command line:

```bash
# Basic usage
npm run cli

# With environment variables
REPO_PATH=/path/to/project \
AI_PROVIDER=claude \
CLAUDE_API_KEY=sk-ant-xxx \
GITHUB_TOKEN=ghp_xxx \
npm run cli

# Or directly
node src/cli.js
```

**Environment variables override .env file settings.**

### API Server Mode

Start the REST API server:

```bash
# Start server
npm start

# Server runs on http://localhost:4000
```

#### API Usage Examples

**1. Start a test run:**

```bash
curl -X POST http://localhost:4000/agent/run \
  -H 'Content-Type: application/json' \
  -d '{
    "repoUrl": "https://github.com/owner/repo",
    "branch": "main",
    "autoStartApp": true,
    "maxIterations": 3,
    "testTypes": ["e2e", "api"],
    "enableBackendValidation": true,
    "generateReport": true
  }'
```

Response:
```json
{
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "pending",
  "message": "Run started successfully"
}
```

**2. Check run status:**

```bash
curl http://localhost:4000/agent/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**3. List all runs:**

```bash
curl http://localhost:4000/agent/runs
```

**4. Stop a run:**

```bash
curl -X POST http://localhost:4000/agent/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890/stop
```

---

## 💡 Usage Examples

## � Usage Examples

### Example 1: Full-Stack Node.js Application

```yaml
# .github/workflows/ignis-testing.yml
name: IGNIS Testing

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Checkout IGNIS
        uses: actions/checkout@v4
        with:
          repository: your-org/ignis-test-agent
          path: .ignis
      
      - run: npm ci
        working-directory: .ignis
      
      - run: npx playwright install --with-deps chromium
        working-directory: .ignis
      
      - run: node src/cli.js
        working-directory: .ignis
        env:
          REPO_PATH: ${{ github.workspace }}
          AI_PROVIDER: claude
          CLAUDE_API_KEY: ${{ secrets.CLAUDE_API_KEY }}
          GITHUB_TOKEN: ${{ github.token }}
          AUTO_START_APP: true
          APP_START_COMMAND: npm start
          APP_SECRETS: '{"DATABASE_URL":"postgresql://localhost/testdb"}'
```

### Example 2: Python/Django Application

```yaml
env:
  REPO_PATH: ${{ github.workspace }}
  AI_PROVIDER: openai
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  GITHUB_TOKEN: ${{ github.token }}
  AUTO_START_APP: true
  APP_START_COMMAND: python manage.py runserver
  TEST_TYPES: e2e,api,accessibility
```

### Example 3: API Server Only (No Frontend)

```yaml
env:
  REPO_PATH: ${{ github.workspace }}
  AI_PROVIDER: gemini
  GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  GITHUB_TOKEN: ${{ github.token }}
  AUTO_START_APP: true
  TEST_TYPES: api,performance
  APP_URL: http://localhost:8080
```

### Example 4: Using API Server Mode

```bash
# Start IGNIS API server
docker run -d \
  -p 4000:4000 \
  -e GITHUB_TOKEN=ghp_xxx \
  -e CLAUDE_API_KEY=sk-ant-xxx \
  ignis-test-agent:latest

# Trigger test run via API
curl -X POST http://localhost:4000/agent/run \
  -H 'Content-Type: application/json' \
  -d '{
    "repoUrl": "https://github.com/myorg/myapp",
    "branch": "develop",
    "autoStartApp": true,
    "maxIterations": 5,
    "enableBackendValidation": true,
    "generateReport": true
  }'

# Poll for status
curl http://localhost:4000/agent/runs/<run-id>
```

---

## 🏗️ Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    IGNIS Test Agent                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐      ┌─────────────────────────┐    │
│  │  CLI / API       │─────▶│  Agent Orchestrator     │    │
│  │  Entry Points    │      │  (Main Pipeline)        │    │
│  └──────────────────┘      └───────────┬─────────────┘    │
│                                         │                   │
│  ┌──────────────────────────────────────▼─────────┐       │
│  │           Core Components                      │       │
│  ├────────────────────────────────────────────────┤       │
│  │  • RepoManager      - Git operations           │       │
│  │  • StackDetector    - Tech stack detection     │       │
│  │  • CodeAnalyzer     - AI-powered analysis      │       │
│  │  • BackendValidator - Security & best practice │       │
│  │  • TestGenerator    - Playwright test creation │       │
│  │  • TestRunner       - Test execution           │       │
│  │  • IssueFixer       - Auto-fix with validation │       │
│  │  • ReportGenerator  - Comprehensive reports    │       │
│  │  • AppLauncher      - Target app management    │       │
│  └────────────────────────────────────────────────┘       │
│                                                             │
│  ┌──────────────────────────────────────────────┐         │
│  │         AI Provider Abstraction               │         │
│  ├──────────────────────────────────────────────┤         │
│  │  • Claude (Anthropic)  • OpenAI  • Gemini    │         │
│  └──────────────────────────────────────────────┘         │
│                                                             │
│  ┌──────────────────────────────────────────────┐         │
│  │         External Integrations                 │         │
│  ├──────────────────────────────────────────────┤         │
│  │  • GitHub API (PR creation, commits)         │         │
│  │  • Playwright (Test execution)               │         │
│  │  • PostgreSQL (Optional state storage)       │         │
│  └──────────────────────────────────────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
devAutomationTestAgent/
├── src/
│   ├── index.js              # API server entry point
│   ├── cli.js                # CLI entry point
│   │
│   ├── api/                  # REST API routes
│   │   ├── routes.js         # Express routes
│   │   └── middleware.js     # Auth, logging, errors
│   │
│   ├── core/                 # Core business logic
│   │   ├── agent-orchestrator.js   # Main pipeline (13 steps)
│   │   ├── repo-manager.js         # Git/GitHub operations
│   │   ├── stack-detector.js       # Tech stack detection
│   │   ├── code-analyzer.js        # AI-powered code analysis
│   │   ├── backend-validator.js    # Security & best practices
│   │   ├── test-generator.js       # Test suite generation
│   │   ├── test-runner.js          # Playwright test execution
│   │   ├── issue-fixer.js          # AI-powered auto-fixing
│   │   ├── report-generator.js     # Comprehensive reporting
│   │   ├── app-launcher.js         # Target app management
│   │   ├── dependency-installer.js # Auto-install dependencies
│   │   └── env-handler.js          # Environment resolution
│   │
│   ├── ai/                   # AI provider abstraction
│   │   ├── provider-factory.js     # Provider selection
│   │   ├── base-provider.js        # Abstract base class
│   │   ├── claude-provider.js      # Anthropic Claude
│   │   ├── openai-provider.js      # OpenAI GPT
│   │   └── gemini-provider.js      # Google Gemini
│   │
│   ├── models/               # Database models (optional)
│   │   ├── index.js          # Sequelize initialization
│   │   ├── agent-run.js      # Run tracking model
│   │   └── test-result.js    # Test result model
│   │
│   ├── config/               # Configuration
│   │   ├── default.js        # Default config values
│   │   └── schema.js         # Joi validation schema
│   │
│   └── utils/                # Utilities
│       ├── logger.js         # Winston logger
│       └── github-client.js  # GitHub API client
│
├── config/                   # External configuration
│   ├── analysis-prompts.json # Validation rules
│   └── agent-config.example.json
│
├── tests/                    # Test suites
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
│
├── scripts/                  # Utility scripts
│   └── validate-setup.js     # Setup validator
│
├── logs/                     # Log files
├── reports/                  # Generated reports
├── workspace/                # Temporary workspaces
│
├── .env.example              # Environment template
├── Dockerfile                # Container definition
├── docker-compose.yml        # Multi-container setup
├── action.yml                # GitHub Action definition
└── package.json              # Dependencies & scripts
```

### Workflow Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                  IGNIS Agent Workflow (v2.0)                    │
└─────────────────────────────────────────────────────────────────┘

 1. Initialize Run
    └─▶ Generate run ID, set status to 'pending'

 2. Acquire Repository
    └─▶ Clone from GitHub OR use local workspace (GitHub Actions)

 3. Install Dependencies
    └─▶ Detect package manager (npm/yarn/pnpm)
    └─▶ Install project dependencies
    └─▶ Install Playwright browsers

 4. Resolve Environment
    └─▶ Read .env files, parse secrets
    └─▶ Generate complete environment configuration

 5. Detect Tech Stack
    └─▶ Identify framework, language, build tools
    └─▶ Detect database, frontend libraries

 6. Analyze Codebase (AI)
    └─▶ Read all source files
    └─▶ Identify components, routes, pages
    └─▶ Extract business logic

 6a. Validate Backend (NEW)
     └─▶ Detect API endpoints
     └─▶ Check security vulnerabilities
     └─▶ Validate authentication/authorization
     └─▶ Identify performance issues

 6b. Check Best Practices (NEW)
     └─▶ Validate RESTful design
     └─▶ Check code quality metrics
     └─▶ Review error handling
     └─▶ Assess architecture patterns

 6c. Generate & Apply Backend Fixes (NEW)
     └─▶ Create fixes for critical issues
     └─▶ Apply fixes to codebase
     └─▶ Commit backend fixes

 7. Generate Test Suites (AI)
    └─▶ Create E2E tests (Playwright)
    └─▶ Create API tests
    └─▶ Create visual regression tests
    └─▶ Create accessibility tests
    └─▶ Create performance tests

 8. Start Target Application
    └─▶ Auto-detect start command
    └─▶ Launch application with environment
    └─▶ Wait for health check

 9. Iteration Loop (Max: 3 by default)
    ┌────────────────────────────────────┐
    │  9a. Run All Tests                 │
    │  9b. All Tests Pass? ─┐            │
    │                       YES → DONE   │
    │  9c. Max Iterations? ─┘            │
    │                       YES → STOP   │
    │  9d. Root-Cause Analysis (AI)      │
    │  9e. Generate Fixes (AI)           │
    │  9f. Apply Fixes                   │
    │  9g. Validate Fixes (Regression)   │
    │  9h. Commit Validated Fixes        │
    │  └──────────────┬─────────────────┘
    │                 │
    └─────────────────┘ Repeat

10. Stop Target Application
    └─▶ Gracefully terminate app process

11. Generate Comprehensive Report (NEW)
    └─▶ Executive summary
    └─▶ Security audit results
    └─▶ Performance analysis
    └─▶ Root cause analysis (RCA)
    └─▶ Detailed recommendations
    └─▶ Timestamp and metadata

12. Create Pull Request(s)
    └─▶ Push fix branch to GitHub
    └─▶ Create PR with detailed description
    └─▶ Attach test report and analysis
    └─▶ Include recommendations

13. Return Summary
    └─▶ Status, iteration count, test results
    └─▶ Files modified, PRs created
    └─▶ Execution duration
```

---

## 🔧 How It Works

### 1. **Repository Analysis**
The agent reads your entire codebase and uses AI to understand:
- Project structure and architecture
- Tech stack and frameworks
- API endpoints and routes
- Database models and queries
- Frontend components and pages

### 2. **Backend Validation**
Performs comprehensive security and quality checks:
- **Security**: SQL injection, XSS, CSRF, authentication issues
- **Best Practices**: RESTful design, error handling, code quality
- **Performance**: Database query optimization, memory leaks
- **Architecture**: Separation of concerns, dependency injection

### 3. **Test Generation**
Creates intelligent test suites using AI:
- **E2E Tests**: User workflows, navigation, form submissions
- **API Tests**: Endpoint testing, status codes, data validation
- **Visual Tests**: Screenshot comparison, layout validation
- **Accessibility Tests**: WCAG compliance, screen reader support
- **Performance Tests**: Load time, bundle size, Core Web Vitals

### 4. **Automated Fixing**
When tests fail, the agent:
1. Analyzes root cause using AI
2. Generates targeted fixes
3. Applies fixes to code
4. Validates fixes (prevents regressions)
5. Commits successful fixes
6. Reverts problematic fixes

### 5. **Iterative Improvement**
Runs up to `MAX_ITERATIONS` (default: 3) cycles:
- Each iteration fixes more issues
- Learns from previous failures
- Validates against existing passing tests
- Stops when all tests pass or max iterations reached

### 6. **Pull Request Creation**
Automatically creates PRs with:
- Detailed description of changes
- Test results and metrics
- Backend validation findings
- Security audit results
- Comprehensive analysis report
- Recommendations for future improvements

---

## �️ Supported Tech Stacks

The IGNIS agent automatically detects and supports:

### Frontend Frameworks
- **React** (including Create React App)
- **Next.js** (App Router and Pages Router)
- **Vue.js** (Vue 2 and Vue 3)
- **Nuxt.js**
- **Angular**
- **Svelte** / **SvelteKit**
- **Static sites** (HTML/CSS/JS)

### Backend Frameworks
- **Node.js**: Express, Fastify, NestJS, Koa, Hapi
- **Python**: Django, Flask, FastAPI, Pyramid
- **PHP**: Laravel, Symfony, CodeIgniter
- **Ruby**: Rails, Sinatra
- **Java**: Spring Boot, Micronaut

### Databases
- **PostgreSQL**
- **MySQL** / **MariaDB**
- **MongoDB**
- **Redis**
- **SQLite**
- **Microsoft SQL Server**

### Package Managers
- **npm**
- **yarn**
- **pnpm**
- **pip**
- **composer**
- **bundler**

---

## �📚 Documentation

- **[Quick Start Guide](./QUICK-START.md)** - Get started in 5 minutes
- **[Deployment Guide](./DEPLOYMENT-GUIDE.md)** - Complete deployment documentation
- **[Implementation Summary](./IMPLEMENTATION-SUMMARY.md)** - Technical implementation details
- **[API Documentation](./IGNIS-API-DOCUMENTATION.md)** - REST API reference
- **[Playwright Validation](./PLAYWRIGHT-AUTOMATION-VALIDATION.md)** - Test automation details
- **[Workflow Diagram](./WORKFLOW-DIAGRAM.md)** - Visual workflow representation

---

## 🎓 Advanced Topics

### Custom Validation Rules

Edit `config/analysis-prompts.json` to add custom rules:

```json
{
  "backendValidation": {
    "securityChecks": [
      "SQL Injection",
      "XSS Vulnerabilities",
      "Your Custom Check"
    ]
  },
  "bestPractices": {
    "codeQuality": [
      "Code Complexity",
      "Your Custom Practice"
    ]
  }
}
```

### Multi-Repository Testing

Use the API server to test multiple repositories:

```bash
# Start API server
docker run -d -p 4000:4000 ignis-test-agent

# Test multiple repos
for repo in repo1 repo2 repo3; do
  curl -X POST http://localhost:4000/agent/run \
    -H 'Content-Type: application/json' \
    -d "{\"repoUrl\":\"https://github.com/org/$repo\"}"
done
```

### CI/CD Integration

Integrate with various CI/CD platforms:

#### Jenkins
```groovy
pipeline {
  agent any
  stages {
    stage('IGNIS Test') {
      steps {
        sh 'docker run --rm ignis-test-agent node src/cli.js'
      }
    }
  }
}
```

#### GitLab CI
```yaml
ignis-test:
  image: ignis-test-agent:latest
  script:
    - node src/cli.js
  artifacts:
    paths:
      - reports/
      - test-results/
```

#### CircleCI
```yaml
jobs:
  ignis-test:
    docker:
      - image: ignis-test-agent:latest
    steps:
      - checkout
      - run: node src/cli.js
      - store_artifacts:
          path: reports/
```

---

## 🔍 Troubleshooting

### Common Issues

**1. Application fails to start**
```bash
# Check logs
docker logs ignis-agent

# Verify APP_START_COMMAND
echo $APP_START_COMMAND

# Manually test start command
cd /path/to/repo && npm start
```

**2. Tests fail to execute**
```bash
# Verify Playwright installation
npx playwright --version

# Reinstall browsers
npx playwright install --with-deps chromium
```

**3. AI API rate limiting**
```bash
# Reduce concurrent requests
export MAX_ITERATIONS=2
export TEST_TYPES=e2e,api

# Or switch provider
export AI_PROVIDER=openai
```

**4. GitHub authentication fails**
```bash
# Verify token permissions
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/user

# Required scopes: repo, workflow
```

### Debug Mode

Enable detailed logging:

```bash
LOG_LEVEL=debug npm run cli
```

Or in GitHub Actions:

```yaml
env:
  LOG_LEVEL: debug
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/your-org/ignis-test-agent/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/ignis-test-agent/discussions)
- **Email**: support@ignis.dev

---

## 🌟 Acknowledgments

- Built with [Playwright](https://playwright.dev/)
- Powered by AI providers: [Anthropic Claude](https://www.anthropic.com/), [OpenAI](https://openai.com/), [Google Gemini](https://deepmind.google/technologies/gemini/)
- GitHub integration via [Octokit](https://github.com/octokit)

---

**Made with ❤️ by the IGNIS Team**
