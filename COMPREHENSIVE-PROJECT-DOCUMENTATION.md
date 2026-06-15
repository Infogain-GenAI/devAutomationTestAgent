# IGNIS Automation Test Agent — Comprehensive Documentation

> **Version**: 2.0.0  
> **Last Updated**: June 2026  
> **Author**: IGNIS Team  
> **License**: MIT

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Sub-Agent Architecture](#3-sub-agent-architecture)
4. [Core Components](#4-core-components)
5. [AI Provider Integration](#5-ai-provider-integration)
6. [Execution Flow & Pipeline](#6-execution-flow--pipeline)
7. [Configuration Reference](#7-configuration-reference)
8. [Setup & Installation](#8-setup--installation)
9. [Deployment Modes](#9-deployment-modes)
10. [API Reference](#10-api-reference)
11. [Test Generation Details](#11-test-generation-details)
12. [Coverage & Iteration Model](#12-coverage--iteration-model)
13. [Prompt Engineering System](#13-prompt-engineering-system)
14. [Technology Stack Detection](#14-technology-stack-detection)
15. [Security & Best Practices](#15-security--best-practices)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Executive Summary

**IGNIS Automation Test Agent** is an AI-powered, fully autonomous testing solution designed to:

- **Analyze** any repository's codebase (structure, APIs, tech stack)
- **Generate** comprehensive unit tests (Jest) and automation tests (Playwright)
- **Validate** generated tests for syntax correctness and fix broken files
- **Execute** tests with coverage measurement, iteratively fixing failures
- **Report** detailed coverage metrics, logs, and summaries
- **Create PRs** with generated tests and application fixes on GitHub

The agent operates as a **GitHub Action** (primary mode), a **CLI tool**, or a **REST API server**, supporting full CI/CD automation without human intervention.

### Key Capabilities

| Capability | Description |
|---|---|
| Multi-AI Provider | Supports OpenAI (GPT-4), Anthropic (Claude), Google (Gemini) |
| Sub-Agent Architecture | 3 independently executable sub-agents with internal iteration |
| Dual Test Pipeline | Unit tests (Jest) + Automation tests (Playwright E2E/API) |
| 95% Coverage Target | Iterates until coverage threshold is met or max iterations reached |
| Smart Test Gap Detection | Scans existing tests, generates only for uncovered areas |
| Backend Validation | Security, error handling, input validation checks on endpoints |
| Auto App Startup | Detects and starts the target application automatically |
| Docker Ready | Production-ready container with Playwright pre-installed |

---

## 2. Architecture Overview

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        IGNIS AUTOMATION TEST AGENT                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────────────┐   │
│  │  GitHub Action │    │   CLI Mode    │    │    API Server Mode    │   │
│  │  (action.yml) │    │  (src/cli.js) │    │   (src/index.js)      │   │
│  └───────┬───────┘    └───────┬───────┘    └───────────┬───────────┘   │
│          │                    │                        │                │
│          └────────────────────┼────────────────────────┘                │
│                               ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    AGENT ORCHESTRATOR                            │   │
│  │              (src/core/agent-orchestrator.js)                    │   │
│  │                                                                 │   │
│  │  ┌─────────────┐  ┌──────────────────┐  ┌─────────────────┐   │   │
│  │  │ GENERATION  │  │   VALIDATION &   │  │  TEST RUNNER &  │   │   │
│  │  │   AGENT     │──│   FIXES AGENT    │──│  COVERAGE AGENT │   │   │
│  │  └─────────────┘  └──────────────────┘  └─────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                               │                                         │
│          ┌────────────────────┼────────────────────┐                   │
│          ▼                    ▼                    ▼                    │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐          │
│  │  AI Provider │   │    Core      │   │   Utilities       │          │
│  │   Factory    │   │  Components  │   │                   │          │
│  │              │   │              │   │  • Logger          │          │
│  │ • OpenAI    │   │ • CodeAnalyzer│   │  • GitHub Client  │          │
│  │ • Claude    │   │ • TestGen    │   │  • Prompt Loader   │          │
│  │ • Gemini    │   │ • TestRunner │   │                   │          │
│  └──────────────┘   │ • DocGen    │   └───────────────────┘          │
│                      │ • AppLauncher│                                   │
│                      │ • IssueFixer│                                   │
│                      │ • ReportGen │                                   │
│                      └──────────────┘                                   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐          │
│  │  PostgreSQL  │   │    GitHub    │   │   File System     │          │
│  │  (optional)  │   │  (PRs, etc)  │   │  (Logs/Reports)  │          │
│  └──────────────┘   └──────────────┘   └───────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
devAutomationTestAgent/
├── action.yml                    # GitHub Action definition
├── Dockerfile                    # Production container
├── package.json                  # Node.js project manifest
├── src/
│   ├── index.js                  # Express API server entry point
│   ├── cli.js                    # CLI entry point (primary for GitHub Actions)
│   ├── agents/                   # Sub-agent implementations
│   │   ├── base-sub-agent.js     # Abstract base class for all sub-agents
│   │   ├── generation-agent.js   # Code analysis + test generation
│   │   ├── validation-agent.js   # Syntax validation + auto-fix
│   │   ├── execution-agent.js    # Test execution + coverage + reporting
│   │   └── index.js              # Agent barrel export
│   ├── ai/                       # AI provider abstraction layer
│   │   ├── base-provider.js      # Abstract AI provider interface
│   │   ├── openai-provider.js    # OpenAI GPT-4 implementation
│   │   ├── claude-provider.js    # Anthropic Claude implementation
│   │   ├── gemini-provider.js    # Google Gemini implementation
│   │   └── provider-factory.js   # Factory pattern for provider creation
│   ├── api/                      # REST API layer
│   │   ├── routes.js             # API endpoints
│   │   └── middleware.js         # Auth, logging, error handling
│   ├── config/                   # Configuration management
│   │   ├── default.js            # Default configuration (env-driven)
│   │   └── schema.js             # Joi validation schema
│   ├── core/                     # Core pipeline components
│   │   ├── agent-orchestrator.js # Main orchestrator (entry point)
│   │   ├── code-analyzer.js      # 3-layer code analysis
│   │   ├── documentation-generator.js  # AI-powered doc generation
│   │   ├── test-generator.js     # Test file generation engine
│   │   ├── test-runner.js        # Playwright automation runner
│   │   ├── unit-test-runner.js   # Jest/Mocha unit test runner
│   │   ├── unit-test-pipeline.js # 7-stage unit test orchestration
│   │   ├── automation-test-pipeline.js  # 6-stage E2E orchestration
│   │   ├── test-coverage-scanner.js     # Gap detection engine
│   │   ├── stack-detector.js     # Tech stack auto-detection
│   │   ├── app-launcher.js       # Target app startup manager
│   │   ├── dependency-installer.js      # Package manager handler
│   │   ├── env-handler.js        # Environment variable resolver
│   │   ├── issue-fixer.js        # AI-powered code fix generator
│   │   ├── backend-validator.js  # Endpoint security validation
│   │   ├── repo-manager.js       # Git operations manager
│   │   └── report-generator.js   # Coverage & summary reports
│   ├── models/                   # Sequelize database models
│   │   ├── index.js              # Database initialization
│   │   ├── agent-run.js          # Run tracking model
│   │   └── test-result.js        # Test result model
│   └── utils/                    # Shared utilities
│       ├── logger.js             # Winston logger
│       ├── github-client.js      # Octokit GitHub API client
│       └── prompt-loader.js      # AI prompt template loader
├── config/
│   ├── agent-config.example.json # Example configuration
│   ├── analysis-prompts.json     # Backend validation prompts
│   └── prompts/                  # AI prompt templates
│       ├── system-analyze-code.md
│       ├── system-generate-tests.md
│       ├── system-generate-unit-tests.md
│       ├── system-verify-unit-tests.md
│       ├── system-fix-unit-tests.md
│       ├── system-generate-api-docs.md
│       ├── system-verify-api-docs.md
│       ├── system-analyze-failures.md
│       ├── system-generate-fix.md
│       ├── system-unit-test-report.md
│       └── user-generate-tests.md
├── scripts/                      # Operational scripts
│   ├── preflight-check.js        # Pre-run validation
│   ├── validate-setup.js         # Setup verification
│   ├── build-production.js       # Production build
│   ├── diagnose-container.js     # Docker diagnostics
│   └── container-entrypoint.sh   # Docker entrypoint
├── tests/                        # Agent's own test suite
│   ├── unit/                     # Unit tests
│   └── integration/              # Integration tests
└── logs/                         # Runtime log files (JSON)
```

---

## 3. Sub-Agent Architecture

The system uses a **three sub-agent model** where each agent is independently executable and internally iterative.

### 3.1 Generation Agent

**File**: `src/agents/generation-agent.js`  
**Purpose**: Analyzes the target codebase and generates all test artifacts.

**Phases (Iteration 0)**:
1. **Code Analysis** — 3-layer filesystem + AI analysis (structure, surface, deep-dive)
2. **Documentation Generation** — Creates feature docs, API docs, edge cases, NFR scenarios
3. **Existing Test Scanning** — Detects already-covered areas to avoid regeneration
4. **Test Generation** — Creates unit tests (Jest) and Playwright specs for uncovered gaps

**Phases (Iteration 1+)**:
- Re-scans for remaining gaps (includes newly generated tests)
- Generates additional tests only for uncovered scenarios
- Iterates until all gaps are filled or max iterations reached

**Output Artifacts**:
- `generated-tests/APPLICATION-DOCUMENTATION.md`
- `generated-tests/application-documentation.json`
- `generated-tests/tests/*.test.js` (unit tests)
- `generated-tests/tests/*.spec.js` (Playwright specs)
- `generated-tests/playwright.config.js`

### 3.2 Validation & Fixes Agent

**File**: `src/agents/validation-agent.js`  
**Purpose**: Validates all generated tests and automatically fixes broken files.

**Phases (per iteration)**:
1. **Framework & Dependency Validation** — Installs Playwright, Jest, required packages
2. **Syntax Validation** — Node.js `vm.Script` compilation check for every test file
3. **Auto-Fix Broken Files** — AI-powered fix generation for syntax errors
4. **Playwright List Check** — `npx playwright test --list` to catch runtime import errors
5. **Removal of Unfixable Files** — Cleans unfixable tests to prevent blocking

**Iteration Logic**:
- Iterates until all files pass validation or max iterations reached
- Tracks `validFiles`, `brokenFiles`, `fixed`, `removed` counts
- Coverage = percentage of valid files out of total generated

### 3.3 Execution Agent (Test Runner & Coverage)

**File**: `src/agents/execution-agent.js`  
**Purpose**: Executes all tests, measures coverage, fixes failures, generates reports.

**Phases (per iteration)**:
1. **Unit Test Execution** — Runs via `UnitTestPipeline` (iteration 0) or `UnitTestRunner` (iteration 1+)
2. **Automation Test Execution** — Runs via `AutomationTestPipeline` (iteration 0) or `TestRunner` (iteration 1+)
3. **Coverage Assessment** — Calculates unit, automation, and combined coverage
4. **Failure Fixing** — AI-powered analysis and fix generation for failed tests
5. **Report & Log Generation** — Creates comprehensive test execution reports

**Dual Pipeline (Iteration 0)**:
- **Unit Test Pipeline** (7 stages): Dependency verification → API doc generation → Doc verification → Unit test generation (chunked) → Test verification → Execution (Jest) → Iterative fixing
- **Automation Test Pipeline** (6 stages): Playwright verification → E2E/API test generation (chunked) → Test verification → Execution → Iterative fixing → Report generation

---

## 4. Core Components

### 4.1 Agent Orchestrator (`src/core/agent-orchestrator.js`)

The central coordinator that:
- Creates all sub-agent instances with shared dependencies
- Manages the main iteration loop (configurable via `agent.maxIterations`)
- Supports three execution modes:
  - **Full Pipeline** — Runs all 3 sub-agents sequentially
  - **Single Agent** — Runs one specific sub-agent (via `RUN_AGENT` env var)
  - **Legacy Pipeline** — Monolithic execution (backward compatibility)

```javascript
// Execution flow
orchestrator.run(runConfig)
  → runSubAgentPipeline()
    → generationAgent.execute(context)
    → validationAgent.execute(context)
    → executionAgent.execute(context)
    → [repeat if coverage < threshold]
```

### 4.2 Code Analyzer (`src/core/code-analyzer.js`)

**3-Layer Analysis**:
1. **Layer 1: Structure Scan** — Pure filesystem analysis (no AI)
   - File tree, size stats, extension distribution
   - Key config files (package.json, tsconfig, Dockerfile, etc.)
   - Directory categorization (src, api, models, etc.)

2. **Layer 2: Surface Analysis** — Lightweight AI + pattern matching
   - Route extraction (Express, Next.js, Nuxt, etc.)
   - API endpoint identification
   - Component listing
   - Database model extraction

3. **Layer 3: Deep Dive** — Full AI analysis
   - Detailed function signatures
   - Business logic mapping
   - Auth flows, middleware chains
   - Error handling patterns

### 4.3 Test Generator (`src/core/test-generator.js`)

Generates two categories of tests:
- **Unit/Integration Tests** (`.test.js`) — Jest-based, backend-focused
- **Playwright Tests** (`.spec.js`) — E2E, API, Visual, Accessibility, Performance

Features:
- Chunked generation (5 files/endpoints per AI call) for large codebases
- Gap-aware: generates only for uncovered scenarios
- Uses application documentation as context for realistic test data
- Post-generation syntax validation with auto-fix retry

### 4.4 App Launcher (`src/core/app-launcher.js`)

Automatically starts the target application for E2E testing:
- Detects start command from `package.json`, docker-compose, or config
- Port detection with conflict resolution
- Retry mechanism (3 attempts with port kill between retries)
- Health polling to confirm the app is ready
- Supports custom start commands and pre-provided URLs

### 4.5 Backend Validator (`src/core/backend-validator.js`)

Validates backend code quality using AI-powered analysis:
- **Endpoint Validation** — Security, error handling, input validation
- **Best Practices Check** — RESTful design, code quality, naming conventions
- Generates fixes for critical/high severity issues
- Configurable via `config/analysis-prompts.json`

### 4.6 Report Generator (`src/core/report-generator.js`)

Produces:
- JSON test result logs (timestamped in `logs/`)
- GitHub Actions step summaries
- Coverage reports (unit + automation + combined)
- Detailed per-file execution logs

---

## 5. AI Provider Integration

### Provider Architecture

```
┌───────────────────────────────────────────┐
│            Provider Factory                │
│       (src/ai/provider-factory.js)        │
├───────────────────────────────────────────┤
│                                           │
│  createProvider(config)     ──────────┐   │
│  createCodeGenProvider(config) ────┐  │   │
│                                   │  │   │
└───────────────────────────────────┼──┼───┘
                                    │  │
         ┌──────────────────────────┘  │
         ▼                             ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ ClaudeProvider│  │OpenAIProvider│  │GeminiProvider│
│              │  │              │  │              │
│ claude-sonnet│  │ gpt-4-turbo  │  │ gemini-1.5   │
│ -4           │  │              │  │ -pro         │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Dual Provider Strategy

The system supports a **dual-provider** configuration:
- **Primary Provider** — Used for analysis, documentation, surface-level tasks
- **Code Generation Provider** (optional) — Dedicated Claude instance for test generation, fix generation, and failure analysis

This is activated by setting `CODE_GENERATION_CLAUDE_API_KEY`, enabling best-of-both-worlds approach (e.g., GPT-4 for analysis + Claude for code generation).

### Supported Models

| Provider | Model | Best For |
|---|---|---|
| OpenAI | `gpt-4-turbo` | General analysis, documentation |
| Anthropic | `claude-sonnet-4-20250514` | Code generation, test writing |
| Google | `gemini-1.5-pro` | Multi-modal analysis |

---

## 6. Execution Flow & Pipeline

### Complete Pipeline Flow (Full Mode)

```
┌──────────────────────────────────────────────────────────────────────┐
│                         MAIN PIPELINE                                 │
│                  (max iterations: configurable)                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─── PRE-FLIGHT ──────────────────────────────────────────────────┐│
│  │ 1. Validate environment variables (AI key, repo path)           ││
│  │ 2. Validate configuration schema (Joi)                          ││
│  │ 3. Determine workspace path                                     ││
│  │ 4. Parse app secrets                                            ││
│  └─────────────────────────────────────────────────────────────────┘│
│                              │                                       │
│                              ▼                                       │
│  ┌─── REPOSITORY SETUP ────────────────────────────────────────────┐│
│  │ 1. Clone repo or use local workspace                            ││
│  │ 2. Create fix branch (ignis/fix-<uuid>)                         ││
│  │ 3. Install project dependencies (npm/yarn/pnpm)                 ││
│  │ 4. Install Playwright browsers (chromium)                       ││
│  │ 5. Resolve environment variables (.env)                         ││
│  └─────────────────────────────────────────────────────────────────┘│
│                              │                                       │
│                              ▼                                       │
│  ┌─── GENERATION AGENT ────────────────────────────────────────────┐│
│  │                                                                 ││
│  │  Iteration 0:                                                   ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      ││
│  │  │  Stack   │→ │  Code    │→ │   Doc    │→ │  Test    │      ││
│  │  │Detection │  │ Analysis │  │Generation│  │Generation│      ││
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘      ││
│  │                                                                 ││
│  │  Iteration 1+:                                                  ││
│  │  ┌──────────────┐  ┌──────────────────┐                       ││
│  │  │ Re-scan Gaps │→ │ Generate Missing │                       ││
│  │  └──────────────┘  └──────────────────┘                       ││
│  │                                                                 ││
│  │  Exit: All gaps filled OR max sub-agent iterations reached      ││
│  └─────────────────────────────────────────────────────────────────┘│
│                              │                                       │
│                              ▼                                       │
│  ┌─── VALIDATION AGENT ────────────────────────────────────────────┐│
│  │                                                                 ││
│  │  Per Iteration:                                                 ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      ││
│  │  │ Install  │→ │ Syntax   │→ │ AI-Fix   │→ │Playwright│      ││
│  │  │  Deps    │  │Validation│  │  Broken  │  │List Check│      ││
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘      ││
│  │                                                                 ││
│  │  Exit: All files valid OR max sub-agent iterations reached      ││
│  └─────────────────────────────────────────────────────────────────┘│
│                              │                                       │
│                              ▼                                       │
│  ┌─── EXECUTION AGENT ─────────────────────────────────────────────┐│
│  │                                                                 ││
│  │  Iteration 0 (Full Pipelines):                                  ││
│  │  ┌─────────────────────────────────────────────────────────┐   ││
│  │  │ UNIT TEST PIPELINE (7 stages)                           │   ││
│  │  │ Deps → API Docs → Verify → Generate → Verify → Run → Fix│   ││
│  │  └─────────────────────────────────────────────────────────┘   ││
│  │  ┌─────────────────────────────────────────────────────────┐   ││
│  │  │ AUTOMATION TEST PIPELINE (6 stages)                     │   ││
│  │  │ Playwright → Generate → Verify → Execute → Fix → Report │   ││
│  │  └─────────────────────────────────────────────────────────┘   ││
│  │                                                                 ││
│  │  Iteration 1+ (Re-run with fixes):                              ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      ││
│  │  │Run Unit  │→ │Run E2E   │→ │Calculate │→ │Fix Fails │      ││
│  │  │ Tests    │  │  Tests   │  │ Coverage │  │ (if any) │      ││
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘      ││
│  │                                                                 ││
│  │  Exit: Coverage >= 95% OR max iterations reached                ││
│  └─────────────────────────────────────────────────────────────────┘│
│                              │                                       │
│                              ▼                                       │
│  ┌─── POST-PIPELINE ───────────────────────────────────────────────┐│
│  │ 1. Generate reports (JSON + summary)                            ││
│  │ 2. Commit generated tests + fixes to branch                    ││
│  │ 3. Create PR on GitHub (unless SKIP_PR=true)                   ││
│  │ 4. Write GitHub Actions step summary                           ││
│  │ 5. Upload artifacts (test-results/)                             ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Execution Modes

| Mode | Description | Trigger |
|---|---|---|
| `full` | All 3 sub-agents sequentially | Default (or `RUN_MODE=full`) |
| `generation` | Only Generation Agent | `RUN_MODE=generation` or `RUN_AGENT=generation` |
| `validation` | Only Validation Agent | `RUN_MODE=validation` or `RUN_AGENT=validation` |
| `execution` | Only Execution Agent | `RUN_MODE=execution` or `RUN_AGENT=execution` |

---

## 7. Configuration Reference

### 7.1 Environment Variables (Complete List)

#### Required

| Variable | Description | Example |
|---|---|---|
| `AI_API_KEY` | API key for the selected AI provider | `sk-...` |

#### AI Configuration

| Variable | Default | Description |
|---|---|---|
| `AI_PROVIDER` | `openai` | AI provider: `openai`, `claude`, `gemini` |
| `OPENAI_API_KEY` | — | OpenAI API key (alt to AI_API_KEY) |
| `OPENAI_MODEL` | `gpt-4-turbo` | OpenAI model name |
| `CLAUDE_API_KEY` | — | Anthropic API key (alt to AI_API_KEY) |
| `CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Claude model name |
| `GEMINI_API_KEY` | — | Google Gemini API key (alt to AI_API_KEY) |
| `GEMINI_MODEL` | `gemini-1.5-pro` | Gemini model name |
| `CODE_GENERATION_CLAUDE_API_KEY` | — | Dedicated Claude key for code generation |
| `CODE_GENERATION_CLAUDE_MODEL` | `claude-sonnet-4-20250514` | Model for code generation tasks |

#### Agent Behavior

| Variable | Default | Description |
|---|---|---|
| `MAX_ITERATIONS` | `3` | Main pipeline iterations (full sub-agent cycle) |
| `SUB_AGENT_MAX_ITERATIONS` | `5` | Max iterations per sub-agent |
| `COVERAGE_THRESHOLD` | `95` | Target coverage percentage |
| `RUN_MODE` | `full` | Execution mode: `full`, `generation`, `validation`, `execution` |
| `RUN_AGENT` | — | Run single sub-agent: `generation`, `validation`, `execution` |
| `AGENT_TIMEOUT_MINUTES` | `30` | Maximum runtime before timeout |
| `AGENT_WORK_DIR` | `./workspace` | Working directory for cloned repos |
| `FIX_BRANCH_PREFIX` | `ignis/fix` | Branch prefix for fix PRs |

#### Repository & GitHub

| Variable | Default | Description |
|---|---|---|
| `REPO_PATH` | CWD | Local repository path |
| `REPO_BRANCH` | `main` | Base branch for testing |
| `GITHUB_TOKEN` | — | GitHub PAT or Actions token |
| `GITHUB_AUTH_METHOD` | `pat` | Auth method: `pat`, `app` |
| `GITHUB_APP_ID` | — | GitHub App ID (for app auth) |
| `GITHUB_PRIVATE_KEY` | — | GitHub App private key |
| `GITHUB_INSTALLATION_ID` | — | GitHub App installation ID |
| `SKIP_PR` | `false` | Skip PR creation |

#### Application Under Test

| Variable | Default | Description |
|---|---|---|
| `APP_URL` | — | Pre-deployed application URL |
| `AUTO_START_APP` | `true` | Auto-start the target app |
| `APP_START_COMMAND` | — | Custom start command |
| `APP_PORT` | — | Application port override |
| `APP_SECRETS` | — | JSON string of env vars for the app |
| `TECH_STACK_OVERRIDE` | — | JSON to override stack detection |

#### Testing Configuration

| Variable | Default | Description |
|---|---|---|
| `TEST_TYPES` | `unit,integration,e2e,api` | Comma-separated test types |
| `BROWSERS` | `chromium` | Browsers for Playwright |
| `HEADLESS` | `true` | Run browsers headless |
| `UNIT_TEST_FRAMEWORK` | `auto` | Unit test framework: `auto`, `jest`, `mocha` |
| `RUN_UNIT_TESTS` | `true` | Enable unit test execution |

#### Validation Features

| Variable | Default | Description |
|---|---|---|
| `ENABLE_BACKEND_VALIDATION` | `false` | Enable endpoint security validation |
| `ENABLE_BEST_PRACTICES_CHECK` | `true` | Enable code quality checks |
| `ENABLE_ENDPOINT_VALIDATION` | `true` | Enable API endpoint validation |
| `GENERATE_ANALYSIS_REPORT` | `true` | Generate analysis markdown reports |
| `ANALYSIS_PROMPT_FILE` | `config/analysis-prompts.json` | Backend validation prompts |
| `REPORT_OUTPUT_DIR` | `reports` | Directory for report output |

#### Database (Optional)

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `ignis_agent` | Database name |
| `POSTGRES_USER` | `postgres` | Database user |
| `POSTGRES_PASSWORD` | — | Database password |

#### Logging

| Variable | Default | Description |
|---|---|---|
| `LOG_LEVEL` | `info` | Log level: `error`, `warn`, `info`, `debug` |
| `LOG_DIR` | `logs` | Directory for log files |

### 7.2 JSON Configuration (`config/agent-config.example.json`)

```json
{
  "agent": {
    "maxIterations": 3,
    "timeoutMinutes": 30,
    "branch": "main"
  },
  "ai": {
    "provider": "claude",
    "claude": { "model": "claude-sonnet-4-20250514" },
    "openai": { "model": "gpt-4-turbo" },
    "gemini": { "model": "gemini-1.5-pro" }
  },
  "testing": {
    "types": ["e2e", "api", "visual", "accessibility", "performance"],
    "browsers": ["chromium"],
    "headless": true
  },
  "app": {
    "autoStart": true,
    "startCommand": null,
    "url": null
  }
}
```

---

## 8. Setup & Installation

### 8.1 Prerequisites

| Requirement | Minimum Version | Purpose |
|---|---|---|
| Node.js | >= 18.0.0 | Runtime |
| npm/yarn/pnpm | Latest | Package management |
| Git | 2.x | Repository operations |
| Docker (optional) | 20+ | Container deployment |

### 8.2 Local Development Setup

```bash
# 1. Clone the repository
git clone <repo-url> ignis-test-agent
cd ignis-test-agent/devAutomationTestAgent

# 2. Install dependencies
npm install

# 3. Install Playwright browsers
npx playwright install chromium --with-deps

# 4. Create environment file
cp .env.example .env

# 5. Configure .env with your API keys
# Required: AI_API_KEY (and optionally provider-specific keys)
# Required: REPO_PATH (path to the target project to test)

# 6. Validate setup
npm run validate

# 7. Run preflight checks
npm run preflight
```

### 8.3 Environment File (.env) Template

```env
# === AI Provider Configuration ===
AI_PROVIDER=openai
AI_API_KEY=sk-your-openai-key-here

# Optional: Dedicated Claude for code generation
# CODE_GENERATION_CLAUDE_API_KEY=sk-ant-your-claude-key
# CODE_GENERATION_CLAUDE_MODEL=claude-sonnet-4-20250514

# === Target Repository ===
REPO_PATH=/path/to/your/target/project
REPO_BRANCH=main

# === Agent Configuration ===
MAX_ITERATIONS=3
SUB_AGENT_MAX_ITERATIONS=5
COVERAGE_THRESHOLD=95
RUN_MODE=full

# === Application Under Test ===
AUTO_START_APP=true
# APP_URL=http://localhost:3000
# APP_START_COMMAND=npm run dev

# === Testing ===
TEST_TYPES=unit,integration,e2e,api
HEADLESS=true

# === GitHub (for PR creation) ===
# GITHUB_TOKEN=ghp_your_token_here
# SKIP_PR=true

# === Logging ===
LOG_LEVEL=info
LOG_DIR=logs
```

### 8.4 Running the Agent

```bash
# Full pipeline (CLI mode — recommended for local testing)
npm run cli

# Or directly
node src/cli.js

# Run specific sub-agent
RUN_AGENT=generation node src/cli.js
RUN_AGENT=validation node src/cli.js
RUN_AGENT=execution node src/cli.js

# Run in API server mode
npm start
# Then POST to http://localhost:4000/agent/run

# Quick local test with preflight
npm run test:local
```

---

## 9. Deployment Modes

### 9.1 GitHub Action (Primary)

Add to your repository's `.github/workflows/`:

```yaml
name: IGNIS Automation Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Run IGNIS Test Agent
        uses: your-org/ignis-test-agent@main
        with:
          branch: ${{ github.ref_name }}
          ai-provider: openai
          ai-api-key: ${{ secrets.OPENAI_API_KEY }}
          max-iterations: '3'
          test-types: 'e2e,api,unit'
          auto-start-app: 'true'
```

**GitHub Action Inputs**:

| Input | Required | Default | Description |
|---|---|---|---|
| `branch` | No | `main` | Branch to test |
| `ai-provider` | No | `openai` | AI provider choice |
| `ai-api-key` | **Yes** | — | API key for AI provider |
| `max-iterations` | No | `3` | Max fix iterations |
| `test-types` | No | `e2e,api,visual,accessibility,performance` | Test types to generate |
| `app-url` | No | — | Pre-deployed app URL |
| `auto-start-app` | No | `true` | Auto-start target app |
| `app-start-command` | No | — | Custom start command |
| `tech-stack-override` | No | — | JSON tech stack override |
| `app-secrets` | No | — | JSON env vars for the app |

### 9.2 Docker Deployment

```bash
# Build the image
docker build -t ignis-test-agent:latest .

# Run CLI mode (test a local repo)
docker run --rm \
  -v /path/to/target/repo:/app/workspace \
  -e AI_PROVIDER=openai \
  -e AI_API_KEY=sk-your-key \
  -e REPO_PATH=/app/workspace \
  -e AUTO_START_APP=true \
  ignis-test-agent:latest

# Run API server mode
docker run -d \
  -p 4000:4000 \
  -e AI_PROVIDER=openai \
  -e AI_API_KEY=sk-your-key \
  ignis-test-agent:latest node src/index.js

# Diagnose container issues
docker run --rm ignis-test-agent:latest node scripts/diagnose-container.js
```

**Docker Image Details**:
- Base: `mcr.microsoft.com/playwright:v1.50.0-noble`
- Pre-installed: Chromium, Jest, Mocha, Chai, ts-jest, @swc/jest, supertest
- Non-root user: `pwuser` (security)
- Health check: HTTP on port 4000
- Size: ~1.5GB (Playwright + browsers)

### 9.3 API Server Mode

```bash
# Start the server
node src/index.js
# Server runs on port 4000 (configurable via PORT env)
```

The API server provides:
- `POST /agent/run` — Start a new test run
- `GET /agent/runs` — List all runs
- `GET /agent/runs/:id` — Get run status/results
- `GET /health` — Health check endpoint

---

## 10. API Reference

### POST /agent/run

Start a new autonomous test run.

**Request Body**:
```json
{
  "repoUrl": "https://github.com/org/repo.git",
  "branch": "main",
  "appUrl": "http://localhost:3000",
  "maxIterations": 3,
  "aiProvider": "openai",
  "testTypes": ["e2e", "api", "unit"],
  "techStackOverride": { "backend": { "framework": "express" } },
  "appSecrets": { "DATABASE_URL": "..." },
  "autoStartApp": true,
  "appStartCommand": "npm run dev"
}
```

**Response** (202 Accepted):
```json
{
  "runId": "a1b2c3d4-...",
  "status": "pending",
  "message": "Agent run started. Poll GET /agent/runs/:id for status."
}
```

### GET /agent/runs/:id

**Response**:
```json
{
  "runId": "a1b2c3d4-...",
  "status": "completed",
  "iterations": 2,
  "coverage": {
    "unit": 92,
    "automation": 88,
    "combined": 90
  },
  "testsGenerated": 24,
  "testsPassed": 22,
  "testsFailed": 2,
  "fixesApplied": 5,
  "duration": "4m 32s"
}
```

### GET /health

**Response**: `200 OK`
```json
{ "status": "healthy", "version": "2.0.0" }
```

---

## 11. Test Generation Details

### 11.1 Unit Test Generation

**Framework**: Jest (with @swc/jest for fast compilation)

**What Gets Tested**:
- All exported functions and classes
- API route handlers (Express, Next.js, Fastify, etc.)
- Service layer business logic
- Middleware functions
- Data models and validators
- Utility/helper functions

**Generation Strategy**:
- Chunked processing: 5 source files per AI call
- Each file gets: happy path, error cases, edge cases, boundary values
- Mocks external dependencies (DB, HTTP, filesystem)
- Respects existing test patterns in the repository

**Output Structure**:
```
generated-tests/
├── tests/
│   ├── api/
│   │   ├── users.test.js
│   │   └── auth.test.js
│   ├── services/
│   │   └── payment-service.test.js
│   └── utils/
│       └── validators.test.js
└── jest.config.js
```

### 11.2 Automation Test Generation (Playwright)

**Framework**: Playwright 1.50.0

**Test Types Generated**:

| Type | Description |
|---|---|
| `e2e` | End-to-end user flows (login, CRUD, navigation) |
| `api` | REST API endpoint testing (status codes, payloads, auth) |
| `visual` | Visual regression testing (screenshots, layout) |
| `accessibility` | WCAG compliance checks (aria, roles, contrast) |
| `performance` | Load time, response time, Core Web Vitals |

**Generation Strategy**:
- Chunked processing: 5 endpoints/pages per AI call
- Covers: 200 (success), 400 (bad request), 401 (unauthorized), 404 (not found), 500 (server error)
- Uses realistic test data derived from API documentation
- Page Object Model pattern for E2E tests

**Output Structure**:
```
generated-tests/
├── tests/
│   ├── e2e/
│   │   ├── login-flow.spec.js
│   │   └── user-management.spec.js
│   ├── api/
│   │   ├── users-api.spec.js
│   │   └── products-api.spec.js
│   ├── visual/
│   │   └── homepage-visual.spec.js
│   └── accessibility/
│       └── navigation-a11y.spec.js
├── playwright.config.js
└── APPLICATION-DOCUMENTATION.md
```

### 11.3 Smart Test Gap Detection

The `TestCoverageScanner` (`src/core/test-coverage-scanner.js`) prevents redundant test generation:

1. **Scans** the repository for existing test files
2. **Maps** existing coverage to endpoints/functions
3. **Identifies** uncovered areas (gaps)
4. **Generates** a test plan specifying:
   - Which types to generate (`generate: true/false`)
   - Scope (`full` or `partial`)
   - Specific targets for partial generation

---

## 12. Coverage & Iteration Model

### 12.1 Dual Coverage Measurement

```
┌─────────────────────────────────────────────┐
│           COMBINED COVERAGE                  │
│                                             │
│  ┌──────────────────┐  ┌──────────────────┐│
│  │  Unit Coverage   │  │ Automation Coverage││
│  │                  │  │                  ││
│  │ • Lines          │  │ • Endpoints hit  ││
│  │ • Branches       │  │ • Status codes   ││
│  │ • Functions      │  │ • Error paths    ││
│  │ • Statements     │  │ • User flows     ││
│  └──────────────────┘  └──────────────────┘│
│                                             │
│  Combined = weighted average                │
│  Target: 95% (configurable)                 │
└─────────────────────────────────────────────┘
```

### 12.2 Iteration Model Explained

```
MAIN ITERATIONS (agent.maxIterations = 3)
├── Main Iteration 1
│   ├── Generation Agent (sub-iterations: up to 5)
│   │   ├── Sub-iter 0: Full analysis + generation
│   │   ├── Sub-iter 1: Re-scan gaps, generate more
│   │   └── Sub-iter 2: Final gap check (exits if complete)
│   ├── Validation Agent (sub-iterations: up to 5)
│   │   ├── Sub-iter 0: Validate all, fix broken
│   │   └── Sub-iter 1: Re-validate (exits if all valid)
│   └── Execution Agent (sub-iterations: up to 5)
│       ├── Sub-iter 0: Full pipeline run
│       ├── Sub-iter 1: Re-run with fixes
│       └── Sub-iter 2: Final coverage check (exits if >= 95%)
├── Main Iteration 2 (only if coverage < 95%)
│   └── ... (repeats with accumulated context)
└── Main Iteration 3 (only if still < 95%)
    └── ... (final attempt)
```

**Exit Conditions**:
- Coverage >= threshold (success)
- Max main iterations reached (partial success)
- Max sub-agent iterations reached (proceeds to next agent)
- Fatal error (stops pipeline)

---

## 13. Prompt Engineering System

### Prompt Templates Location

All AI prompt templates are in `config/prompts/`:

| File | Purpose |
|---|---|
| `system-analyze-code.md` | Code analysis system prompt |
| `system-generate-tests.md` | Playwright test generation |
| `system-generate-unit-tests.md` | Unit test generation |
| `system-verify-unit-tests.md` | Unit test syntax verification |
| `system-fix-unit-tests.md` | Unit test failure fix generation |
| `system-generate-api-docs.md` | API documentation generation |
| `system-verify-api-docs.md` | API documentation verification |
| `system-analyze-failures.md` | Test failure root cause analysis |
| `system-generate-fix.md` | Application/test code fix generation |
| `system-unit-test-report.md` | Unit test report formatting |
| `user-generate-tests.md` | User context for test generation |

### Prompt Loading

Prompts are loaded dynamically by `src/utils/prompt-loader.js` and injected as system messages to the AI provider. Variables in templates (e.g., `{{TECH_STACK}}`, `{{CODE_CONTEXT}}`) are interpolated at runtime.

---

## 14. Technology Stack Detection

The `StackDetector` (`src/core/stack-detector.js`) automatically identifies:

### Frontend Frameworks
- React, Next.js, Vue.js, Nuxt, Angular, Svelte, SvelteKit

### Backend Frameworks
- Express.js, Fastify, NestJS, Next.js API Routes, Nuxt Server Routes, Koa, Hapi

### Database Detection
- PostgreSQL (pg, prisma), MongoDB (mongoose), MySQL, SQLite, Redis

### Language Detection
- JavaScript, TypeScript, Python, Go, Ruby, Java

### Package Manager Detection
- npm (package-lock.json)
- yarn (yarn.lock)
- pnpm (pnpm-lock.yaml)

### Override
Force detection with `TECH_STACK_OVERRIDE`:
```json
{
  "frontend": { "framework": "nextjs", "dir": "." },
  "backend": { "framework": "express", "dir": "server" },
  "database": "postgresql"
}
```

---

## 15. Security & Best Practices

### Security Measures

1. **Non-root Docker** — Runs as `pwuser` inside containers
2. **No secrets in logs** — API keys are truncated in output
3. **Input validation** — Joi schema validates all configuration
4. **Auth middleware** — API server authenticates requests
5. **Backend validation** — Automated security scanning of target code:
   - SQL injection detection
   - Missing authentication checks
   - Input validation gaps
   - Error message information leakage
   - CORS misconfiguration

### Test Generation Best Practices

1. **Extend, never rewrite** — Existing tests are preserved
2. **Edge cases mandatory** — Boundary values, null inputs, overflow
3. **NFR scenarios** — Performance, scalability, concurrency
4. **Security tests** — Auth bypass, injection, IDOR
5. **Realistic data** — AI generates contextually appropriate test data
6. **Isolation** — Tests are independent and parallelizable

### Operational Safety

1. **Fix branch isolation** — All changes on `ignis/fix-*` branches
2. **PR-based delivery** — Never pushes directly to main
3. **Graceful degradation** — Non-fatal errors don't stop the pipeline
4. **Timeout protection** — Configurable max runtime (default 30 min)
5. **Retry with backoff** — App startup retries with port cleanup

---

## 16. Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|---|---|---|
| "No AI API key found" | Missing env var | Set `AI_API_KEY` or provider-specific key |
| "Repository path not found" | Wrong `REPO_PATH` | Set correct absolute path to target project |
| Playwright timeout | App not running | Set `APP_URL` or enable `AUTO_START_APP` |
| "Port already in use" | Previous run didn't clean up | Agent auto-kills; or manually: `lsof -i :3000` |
| Low coverage on first run | Complex codebase | Increase `MAX_ITERATIONS` and `SUB_AGENT_MAX_ITERATIONS` |
| Docker health check failing | Port mismatch | Ensure `PORT=4000` in Docker env |
| Database connection failed | Optional feature | Agent runs without DB (logs warning) |

### Diagnostic Commands

```bash
# Validate entire setup
npm run validate

# Run preflight checks
npm run preflight

# Check Docker container health
npm run docker:diagnose

# View latest test results
cat logs/test-results-*.json | jq '.summary'

# Run agent own tests
npm test
```

### Log Locations

| Log | Location | Format |
|---|---|---|
| Runtime logs | `logs/` | JSON (timestamped) |
| Test results | `logs/test-results-*.json` | JSON |
| Unit test results | `logs/unit-test-results-*.json` | JSON |
| Generated docs | `<target>/generated-tests/APPLICATION-DOCUMENTATION.md` | Markdown |
| Coverage reports | `<target>/test-results/` | JSON + Markdown |

---

## Appendix A: Dependency List

### Production Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.52.0 | Anthropic Claude API client |
| `@google/generative-ai` | ^0.24.0 | Google Gemini API client |
| `openai` | ^4.85.4 | OpenAI GPT API client |
| `playwright` | 1.50.0 | Browser automation framework |
| `express` | ^4.21.2 | REST API server |
| `sequelize` | ^6.37.5 | ORM for PostgreSQL |
| `pg` | ^8.13.3 | PostgreSQL client |
| `simple-git` | ^3.27.0 | Git operations |
| `@octokit/rest` | ^21.1.1 | GitHub API client |
| `@octokit/auth-app` | ^7.1.4 | GitHub App authentication |
| `winston` | ^3.17.0 | Structured logging |
| `joi` | ^17.13.3 | Schema validation |
| `dotenv` | ^16.4.7 | Environment variable loader |
| `uuid` | ^11.1.0 | UUID generation |
| `cors` | ^2.8.5 | CORS middleware |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `jest` | ^29.7.0 | Test runner |
| `eslint` | ^9.21.0 | Code linting |

---

## Appendix B: GitHub Action Workflow (Full Example)

```yaml
name: IGNIS Comprehensive Testing

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      max-iterations:
        description: 'Max fix iterations'
        default: '3'
      test-types:
        description: 'Test types (comma-separated)'
        default: 'e2e,api,unit,integration'

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  ignis-test:
    runs-on: ubuntu-latest
    timeout-minutes: 45

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
        ports:
          - 5432:5432

    steps:
      - name: Run IGNIS Automation Test Agent
        uses: your-org/ignis-test-agent@v2
        with:
          branch: ${{ github.head_ref || github.ref_name }}
          ai-provider: openai
          ai-api-key: ${{ secrets.OPENAI_API_KEY }}
          max-iterations: ${{ github.event.inputs.max-iterations || '3' }}
          test-types: ${{ github.event.inputs.test-types || 'e2e,api,unit' }}
          auto-start-app: 'true'
          app-secrets: |
            {
              "DATABASE_URL": "postgresql://postgres:testpass@localhost:5432/testdb",
              "JWT_SECRET": "test-secret"
            }

      - name: Upload Test Results
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: ignis-test-results
          path: test-results/
```

---

## Appendix C: Data Flow Diagram

```
                    ┌─────────────┐
                    │  Target     │
                    │ Repository  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Clone /    │
                    │ Local Path  │
                    └──────┬──────┘
                           │
              ┌────────────▼────────────┐
              │   STACK DETECTION       │
              │ (frontend, backend, DB) │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │   CODE ANALYSIS         │
              │ (structure → surface    │
              │  → deep dive)           │
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │   DOCUMENTATION         │
              │ (features, APIs, edge   │
              │  cases, NFR scenarios)  │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌────────────────┐ ┌──────────────┐ ┌──────────────┐
│  Unit Tests    │ │  E2E Tests   │ │  API Tests   │
│  (.test.js)   │ │  (.spec.js)  │ │  (.spec.js)  │
└───────┬────────┘ └──────┬───────┘ └──────┬───────┘
        │                  │                │
        └──────────────────┼────────────────┘
                           │
              ┌────────────▼────────────┐
              │   VALIDATION            │
              │ (syntax check → fix →   │
              │  re-validate)           │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                                   ▼
┌────────────────┐                 ┌────────────────┐
│  Jest Runner   │                 │  Playwright    │
│  (unit tests)  │                 │  (automation)  │
└───────┬────────┘                 └───────┬────────┘
        │                                  │
        └──────────────┬───────────────────┘
                       │
              ┌────────▼────────┐
              │ COVERAGE CHECK  │
              │ (>= 95%?)      │
              └────────┬────────┘
                       │
            ┌──────────┼──────────┐
            │ YES      │          │ NO
            ▼          │          ▼
    ┌──────────┐       │  ┌──────────────┐
    │ REPORTS  │       │  │  FIX + RETRY │
    │  + PR    │       │  │  (next iter) │
    └──────────┘       │  └──────────────┘
                       │
              ┌────────▼────────┐
              │  FINAL OUTPUT   │
              │                 │
              │ • Test files    │
              │ • Coverage rpt  │
              │ • GitHub PR     │
              │ • Artifacts     │
              └─────────────────┘
```

---

## Appendix D: Quick Commands Reference

| Command | Description |
|---|---|
| `npm run cli` | Run agent in CLI mode (full pipeline) |
| `npm start` | Start API server on port 4000 |
| `npm run preflight` | Validate environment before running |
| `npm run validate` | Verify installation completeness |
| `npm test` | Run agent's own test suite |
| `npm run test:unit` | Run only unit tests |
| `npm run test:integration` | Run only integration tests |
| `npm run setup` | Install deps + Playwright browsers |
| `npm run test:local` | Preflight + CLI run |
| `npm run build:production` | Production build |
| `npm run docker:build` | Build Docker image |
| `npm run docker:diagnose` | Run container diagnostics |

---

*This document provides a complete reference for understanding, configuring, deploying, and operating the IGNIS Automation Test Agent. For quick-start instructions, see `QUICK-START.md`. For production deployment specifics, see `PRODUCTION-DEPLOYMENT-GUIDE.md`.*
