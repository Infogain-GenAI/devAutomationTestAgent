# IGNIS Automation Test Agent — Comprehensive API & Technical Documentation

> Version 1.0.0 | Last Updated: April 9, 2026

---

## Table of Contents

- [1. Service Overview](#1-service-overview)
- [2. Architecture](#2-architecture)
- [3. Configuration](#3-configuration)
- [4. API Endpoints](#4-api-endpoints)
  - [4.1 POST /agent/run](#41-post-agentrun)
  - [4.2 GET /agent/runs](#42-get-agentruns)
  - [4.3 GET /agent/runs/:id](#43-get-agentrunsid)
  - [4.4 POST /agent/runs/:id/stop](#44-post-agentrunsidstop)
  - [4.5 GET /agent/config](#45-get-agentconfig)
  - [4.6 GET /health](#46-get-health)
- [5. Authentication](#5-authentication)
- [6. Database Models](#6-database-models)
  - [6.1 AgentRun Model](#61-agentrun-model)
  - [6.2 TestResult Model](#62-testresult-model)
  - [6.3 Entity Relationship](#63-entity-relationship)
- [7. Status Lifecycle](#7-status-lifecycle)
- [8. Agent Pipeline — 13-Step Flow](#8-agent-pipeline--13-step-flow)
- [9. Core Modules Reference](#9-core-modules-reference)
- [10. AI Provider Interface](#10-ai-provider-interface)
- [11. CLI Mode (GitHub Actions — Primary)](#11-cli-mode-github-actions--primary)
- [12. GitHub Action Inputs](#12-github-action-inputs)
- [13. Dummy Data & Sample Payloads](#13-dummy-data--sample-payloads)
  - [13.1 Sample API Request/Response Flows](#131-sample-api-requestresponse-flows)
  - [13.2 Sample AgentRun Records](#132-sample-agentrun-records)
  - [13.3 Sample TestResult Records](#133-sample-testresult-records)
  - [13.4 Sample Orchestrator Summary](#134-sample-orchestrator-summary)
  - [13.5 Sample PR Body Output](#135-sample-pr-body-output)
  - [13.6 Sample GitHub Step Summary](#136-sample-github-step-summary)
  - [13.7 Sample Tech Stack Detection](#137-sample-tech-stack-detection)
  - [13.8 Sample Environment Resolution](#138-sample-environment-resolution)
  - [13.9 Sample AI Provider Responses](#139-sample-ai-provider-responses)
  - [13.10 Sample Test Runner Output](#1310-sample-test-runner-output)
  - [13.11 Sample Issue Fixer Output](#1311-sample-issue-fixer-output)
- [14. Error Responses](#14-error-responses)
- [15. Environment Variables Reference](#15-environment-variables-reference)
- [16. File Structure](#16-file-structure)

---

## 1. Service Overview

**IGNIS Automation Test Agent** is a GitHub Actions–first Node.js service that autonomously:

1. Reads code from the **same repository** where the GitHub Action is configured
2. Analyzes the codebase using configurable AI (Claude / OpenAI / Gemini)
3. Generates comprehensive Playwright test suites (E2E, API, Visual, Accessibility, Performance)
4. Runs tests, detects failures, generates fixes (both app code and test code)
5. Iterates until all tests pass or max iterations reached
6. Creates Pull Requests with fixes + full test report

| Property | Value |
|----------|-------|
| Runtime | Node.js ≥ 18 |
| Test Framework | Playwright |
| Server Port | 4000 (API mode) |
| Primary Mode | CLI / GitHub Actions |
| Secondary Mode | REST API server |
| Database | PostgreSQL (API mode, optional) |
| AI Providers | Claude, OpenAI, Gemini |

---

## 2. Architecture

```
ignis-test-agent/
├── src/
│   ├── index.js                  ← API server entry (SECONDARY)
│   ├── cli.js                    ← CLI entry (PRIMARY — GitHub Actions)
│   ├── config/
│   │   ├── default.js            ← Config from env vars
│   │   └── schema.js             ← Joi validation
│   ├── api/
│   │   ├── routes.js             ← Express REST routes
│   │   └── middleware.js          ← Auth, logging, error handling
│   ├── core/
│   │   ├── agent-orchestrator.js ← 13-step main pipeline
│   │   ├── repo-manager.js       ← Git/GitHub operations
│   │   ├── dependency-installer.js ← Auto-install deps
│   │   ├── env-handler.js        ← Environment variable resolution
│   │   ├── stack-detector.js     ← Tech stack auto-detection
│   │   ├── code-analyzer.js      ← 3-layer codebase analysis
│   │   ├── test-generator.js     ← AI Playwright test generation
│   │   ├── test-runner.js        ← Playwright execution + parsing
│   │   ├── app-launcher.js       ← App startup with retry/fallback
│   │   └── issue-fixer.js        ← AI fix gen + validation guardrails
│   ├── ai/
│   │   ├── base-provider.js      ← Abstract AI interface
│   │   ├── claude-provider.js    ← Anthropic Claude
│   │   ├── openai-provider.js    ← OpenAI GPT-4
│   │   ├── gemini-provider.js    ← Google Gemini
│   │   └── provider-factory.js   ← Factory for provider selection
│   ├── models/
│   │   ├── index.js              ← Sequelize init
│   │   ├── agent-run.js          ← AgentRun model
│   │   └── test-result.js        ← TestResult model
│   └── utils/
│       ├── logger.js             ← Winston logger
│       └── github-client.js      ← GitHub PAT + App auth
├── action.yml                    ← GitHub composite action
├── Dockerfile
├── package.json
└── .github/workflows/
    ├── ignis-testing.yml         ← Reusable workflow
    └── example-caller.yml        ← Example for user repos
```

---

## 3. Configuration

All configuration is driven by environment variables, validated at startup with Joi.

### Config Object Shape

```json
{
  "agent": {
    "maxIterations": 3,
    "timeoutMinutes": 30,
    "workDir": "./workspace",
    "branch": "main"
  },
  "github": {
    "authMethod": "pat",
    "token": "ghp_xxxx"
  },
  "ai": {
    "provider": "claude",
    "claude":  { "apiKey": "sk-ant-xxx", "model": "claude-sonnet-4-20250514" },
    "openai":  { "apiKey": "sk-xxx",     "model": "gpt-4-turbo" },
    "gemini":  { "apiKey": "AIza-xxx",   "model": "gemini-1.5-pro" }
  },
  "testing": {
    "types": ["e2e", "api", "visual", "accessibility", "performance"],
    "browsers": ["chromium"],
    "headless": true
  },
  "app": {
    "autoStart": true,
    "startCommand": null,
    "url": null,
    "port": null
  },
  "database": {
    "host": "localhost",
    "port": 5432,
    "name": "ignis_agent",
    "user": "postgres",
    "password": ""
  },
  "logging": {
    "level": "info",
    "dir": "logs"
  }
}
```

---

## 4. API Endpoints

**Base URL:** `http://localhost:4000`

All endpoints return JSON. The API server is the SECONDARY mode (primary is GitHub Actions CLI).

---

### 4.1 POST /agent/run

**Start a new autonomous test agent run.** Returns immediately — the orchestrator runs asynchronously.

| Property | Value |
|----------|-------|
| Method | `POST` |
| Path | `/agent/run` |
| Content-Type | `application/json` |
| Auth | `x-api-key` header (if `IGNIS_API_KEY` is set) |
| Response Code | `202 Accepted` |

#### Request Body

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `repoUrl` | string | **Yes** | — | GitHub repository URL (e.g., `https://github.com/owner/repo`) |
| `branch` | string | No | `"main"` | Branch to test / base branch for fix PRs |
| `appUrl` | string | No | `null` | URL if the target app is already running |
| `maxIterations` | integer | No | `3` | Max fix-and-retest cycles (1–10) |
| `aiProvider` | string | No | `"claude"` | AI provider: `claude`, `openai`, `gemini` |
| `testTypes` | string[] | No | all 5 types | Test types to generate |
| `techStackOverride` | object | No | `null` | Override auto-detected tech stack |
| `appSecrets` | object | No | `null` | Key-value env vars for the target app |
| `autoStartApp` | boolean | No | `false` | Auto-start the target app from its repo |
| `appStartCommand` | string | No | auto-detected | Custom command to start the app |

#### Request Example

```json
{
  "repoUrl": "https://github.com/acme/web-app",
  "branch": "main",
  "maxIterations": 3,
  "aiProvider": "claude",
  "testTypes": ["e2e", "api", "accessibility"],
  "autoStartApp": true,
  "appSecrets": {
    "DATABASE_URL": "postgresql://user:pass@localhost:5432/myapp",
    "JWT_SECRET": "super-secret-key-123"
  }
}
```

#### Response — 202 Accepted

```json
{
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "pending",
  "message": "Agent run started. Poll GET /agent/runs/:id for status."
}
```

#### Error Responses

| Code | Body | Cause |
|------|------|-------|
| `400` | `{ "error": "repoUrl is required" }` | Missing `repoUrl` |
| `400` | `{ "error": "Invalid configuration: ..." }` | Joi validation failure |
| `401` | `{ "error": "Unauthorized — invalid or missing API key" }` | Bad/missing `x-api-key` |
| `500` | `{ "error": "..." }` | Internal server error |

---

### 4.2 GET /agent/runs

**List all agent runs** with pagination support.

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/agent/runs` |
| Auth | `x-api-key` header (if configured) |
| Response Code | `200 OK` |

#### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Results per page (max 100) |

#### Request Example

```
GET /agent/runs?page=1&limit=10
```

#### Response — 200 OK

```json
{
  "total": 42,
  "page": 1,
  "limit": 10,
  "runs": [
    {
      "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "status": "completed",
      "repoUrl": "https://github.com/acme/web-app",
      "startedAt": "2026-04-09T10:15:30.000Z",
      "summary": {
        "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "status": "all-passed",
        "iterations": 2,
        "maxIterations": 3,
        "testResults": { "passed": 28, "failed": 0, "total": 28 },
        "prUrl": "https://github.com/acme/web-app/pull/42",
        "duration": 185200
      }
    },
    {
      "runId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "status": "testing",
      "repoUrl": "https://github.com/acme/api-service",
      "startedAt": "2026-04-09T10:30:00.000Z",
      "summary": null
    }
  ]
}
```

---

### 4.3 GET /agent/runs/:id

**Get detailed status and summary of a specific run.**

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/agent/runs/:id` |
| Auth | `x-api-key` header (if configured) |
| Response Code | `200 OK` or `404 Not Found` |

#### Request Example

```
GET /agent/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

#### Response — 200 OK (run in progress)

```json
{
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "testing",
  "repoUrl": "https://github.com/acme/web-app",
  "startedAt": "2026-04-09T10:15:30.000Z",
  "summary": null
}
```

#### Response — 200 OK (run completed)

```json
{
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "completed",
  "repoUrl": "https://github.com/acme/web-app",
  "startedAt": "2026-04-09T10:15:30.000Z",
  "summary": {
    "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "all-passed",
    "iterations": 2,
    "maxIterations": 3,
    "testResults": {
      "passed": 28,
      "failed": 0,
      "total": 28
    },
    "iterationHistory": [
      {
        "iteration": 1,
        "total": 28,
        "passed": 20,
        "failed": 8,
        "appFixes": 4,
        "testFixes": 1,
        "reverted": 0
      },
      {
        "iteration": 2,
        "total": 28,
        "passed": 28,
        "failed": 0,
        "appFixes": 2,
        "testFixes": 1,
        "reverted": 0
      }
    ],
    "appStarted": true,
    "appStartMethod": "auto-started",
    "prUrl": "https://github.com/acme/web-app/pull/42",
    "reportPrUrl": null,
    "duration": 185200,
    "techStack": {
      "frontend": "react",
      "backend": "express",
      "language": "typescript"
    }
  }
}
```

#### Response — 404

```json
{
  "error": "Run not found"
}
```

---

### 4.4 POST /agent/runs/:id/stop

**Gracefully stop a running agent.**

| Property | Value |
|----------|-------|
| Method | `POST` |
| Path | `/agent/runs/:id/stop` |
| Auth | `x-api-key` header (if configured) |
| Response Code | `200 OK`, `400`, or `404` |

#### Request Example

```
POST /agent/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890/stop
```

#### Response — 200 OK

```json
{
  "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "stopped"
}
```

#### Response — 400 (already terminal)

```json
{
  "error": "Run already completed"
}
```

---

### 4.5 GET /agent/config

**Get the current server configuration (sanitized — no secrets).**

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/agent/config` |
| Auth | `x-api-key` header (if configured) |
| Response Code | `200 OK` |

#### Response — 200 OK

```json
{
  "agent": {
    "maxIterations": 3,
    "timeoutMinutes": 30,
    "workDir": "./workspace",
    "branch": "main"
  },
  "ai": {
    "provider": "claude"
  },
  "testing": {
    "types": ["e2e", "api", "visual", "accessibility", "performance"],
    "browsers": ["chromium"],
    "headless": true
  },
  "app": {
    "autoStart": false,
    "startCommand": null,
    "url": null,
    "port": null
  }
}
```

---

### 4.6 GET /health

**Health check endpoint.**

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/health` |
| Auth | None |
| Response Code | `200 OK` |

#### Response — 200 OK

```json
{
  "status": "healthy",
  "service": "ignis-test-agent",
  "uptime": 3421.567,
  "activeRuns": 1
}
```

---

## 5. Authentication

Authentication is **optional** in the API server. When enabled, all endpoints (except `/health`) require an API key.

| Method | Header | Env Variable |
|--------|--------|-------------|
| API Key | `x-api-key: <key>` | `IGNIS_API_KEY` |
| Query Param | `?apiKey=<key>` | `IGNIS_API_KEY` |

- If `IGNIS_API_KEY` is **not set**, all endpoints are open (no auth).
- If `IGNIS_API_KEY` is **set**, requests without a matching key receive `401 Unauthorized`.

#### 401 Response

```json
{
  "error": "Unauthorized — invalid or missing API key"
}
```

---

## 6. Database Models

The database layer uses **Sequelize** with **PostgreSQL**. It is **optional** — CLI/GitHub Actions mode runs without a database (in-memory tracking only).

### 6.1 AgentRun Model

**Table:** `agent_runs`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | No | auto-generated (UUIDv4) | Primary key |
| `repoUrl` | STRING | No | — | GitHub repository URL |
| `branch` | STRING | Yes | `'main'` | Branch being tested |
| `status` | ENUM | No | `'pending'` | Current pipeline status (see [Status Lifecycle](#7-status-lifecycle)) |
| `currentIteration` | INTEGER | No | `0` | Current iteration number |
| `maxIterations` | INTEGER | No | `3` | Configured max iterations |
| `appUrl` | STRING | Yes | `null` | Target app URL (user-provided or auto-detected) |
| `techStack` | JSONB | Yes | `null` | Detected technology stack |
| `config` | JSONB | Yes | `null` | Run-specific configuration overrides |
| `summary` | JSONB | Yes | `null` | Final run summary with counts and PR links |
| `prUrl` | STRING | Yes | `null` | URL of the fixes Pull Request |
| `reportPrUrl` | STRING | Yes | `null` | URL of the report-only PR (if failures remain) |
| `error` | TEXT | Yes | `null` | Error message if status is `'failed'` |
| `startedAt` | DATE | Yes | `null` | When execution began |
| `completedAt` | DATE | Yes | `null` | When execution finished |
| `createdAt` | DATE | No | auto | Sequelize managed |
| `updatedAt` | DATE | No | auto | Sequelize managed |

#### Dummy AgentRun Record

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "repoUrl": "https://github.com/acme/web-app",
  "branch": "main",
  "status": "completed",
  "currentIteration": 2,
  "maxIterations": 3,
  "appUrl": "http://localhost:3000",
  "techStack": {
    "frontend": { "framework": "react", "version": "18.2.0", "port": 3000 },
    "backend": { "framework": "express", "version": "4.18.2", "port": 8080 },
    "database": { "type": "postgresql" },
    "language": "typescript",
    "monorepo": false,
    "packageManager": "npm"
  },
  "config": {
    "maxIterations": 3,
    "aiProvider": "claude",
    "testTypes": ["e2e", "api", "accessibility"]
  },
  "summary": {
    "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "all-passed",
    "iterations": 2,
    "maxIterations": 3,
    "testResults": { "passed": 28, "failed": 0, "total": 28 },
    "iterationHistory": [
      { "iteration": 1, "total": 28, "passed": 20, "failed": 8, "appFixes": 4, "testFixes": 1, "reverted": 0 },
      { "iteration": 2, "total": 28, "passed": 28, "failed": 0, "appFixes": 2, "testFixes": 1, "reverted": 0 }
    ],
    "appStarted": true,
    "appStartMethod": "auto-started",
    "prUrl": "https://github.com/acme/web-app/pull/42",
    "reportPrUrl": null,
    "duration": 185200,
    "techStack": { "frontend": "react", "backend": "express", "language": "typescript" }
  },
  "prUrl": "https://github.com/acme/web-app/pull/42",
  "reportPrUrl": null,
  "error": null,
  "startedAt": "2026-04-09T10:15:30.000Z",
  "completedAt": "2026-04-09T10:18:35.200Z",
  "createdAt": "2026-04-09T10:15:30.000Z",
  "updatedAt": "2026-04-09T10:18:35.200Z"
}
```

---

### 6.2 TestResult Model

**Table:** `test_results`

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | UUID | No | auto-generated (UUIDv4) | Primary key |
| `runId` | UUID | No | — | Foreign key → `agent_runs.id` |
| `iteration` | INTEGER | No | — | Which iteration this result belongs to |
| `testType` | ENUM | No | — | `e2e`, `api`, `visual`, `accessibility`, `performance` |
| `testFile` | STRING | No | — | Relative file path of the test |
| `status` | ENUM | No | `'passed'` | `passed`, `failed`, `error`, `skipped` |
| `results` | JSONB | Yes | `null` | Detailed test output |
| `failures` | JSONB | Yes | `null` | Failure details with stack traces |
| `fixes` | JSONB | Yes | `null` | Applied fixes for this iteration |
| `duration` | INTEGER | Yes | `null` | Execution time in milliseconds |
| `createdAt` | DATE | No | auto | Sequelize managed |
| `updatedAt` | DATE | No | auto | Sequelize managed |

#### Dummy TestResult Records

```json
[
  {
    "id": "f1a2b3c4-d5e6-7890-abcd-111111111111",
    "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "iteration": 1,
    "testType": "e2e",
    "testFile": "e2e/login.spec.js",
    "status": "failed",
    "results": {
      "testName": "login form submits correctly",
      "duration": 3200,
      "retries": 0
    },
    "failures": {
      "error": "Expected button [data-testid='submit'] to be visible",
      "stackTrace": "Error: expect(locator).toBeVisible()\n  at e2e/login.spec.js:24:28",
      "category": "frontend"
    },
    "fixes": {
      "file": "src/components/LoginForm.jsx",
      "originalCode": "onClick={handleLogin}",
      "fixedCode": "onClick={(e) => { e.preventDefault(); handleLogin(); }}",
      "explanation": "Form submission was not preventing default browser behavior"
    },
    "duration": 3200,
    "createdAt": "2026-04-09T10:16:15.000Z",
    "updatedAt": "2026-04-09T10:16:15.000Z"
  },
  {
    "id": "f1a2b3c4-d5e6-7890-abcd-222222222222",
    "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "iteration": 1,
    "testType": "api",
    "testFile": "api/users-api.spec.js",
    "status": "passed",
    "results": {
      "testName": "GET /api/users returns user list",
      "duration": 450,
      "retries": 0
    },
    "failures": null,
    "fixes": null,
    "duration": 450,
    "createdAt": "2026-04-09T10:16:18.000Z",
    "updatedAt": "2026-04-09T10:16:18.000Z"
  },
  {
    "id": "f1a2b3c4-d5e6-7890-abcd-333333333333",
    "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "iteration": 1,
    "testType": "accessibility",
    "testFile": "accessibility/a11y.spec.js",
    "status": "failed",
    "results": {
      "testName": "homepage passes axe accessibility scan",
      "duration": 8100,
      "retries": 0
    },
    "failures": {
      "error": "3 accessibility violations found: missing alt text, low contrast ratio, no form labels",
      "stackTrace": "AxeResults at accessibility/a11y.spec.js:15",
      "category": "frontend"
    },
    "fixes": null,
    "duration": 8100,
    "createdAt": "2026-04-09T10:16:25.000Z",
    "updatedAt": "2026-04-09T10:16:25.000Z"
  },
  {
    "id": "f1a2b3c4-d5e6-7890-abcd-444444444444",
    "runId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "iteration": 2,
    "testType": "e2e",
    "testFile": "e2e/login.spec.js",
    "status": "passed",
    "results": {
      "testName": "login form submits correctly",
      "duration": 2800,
      "retries": 0
    },
    "failures": null,
    "fixes": null,
    "duration": 2800,
    "createdAt": "2026-04-09T10:17:45.000Z",
    "updatedAt": "2026-04-09T10:17:45.000Z"
  }
]
```

---

### 6.3 Entity Relationship

```
┌──────────────────────┐         ┌──────────────────────┐
│      agent_runs       │         │    test_results       │
├──────────────────────┤         ├──────────────────────┤
│ id (PK, UUID)        │◄──────┐ │ id (PK, UUID)        │
│ repoUrl              │       │ │ runId (FK → agent_runs)│
│ branch               │       └─│ iteration             │
│ status (ENUM)        │         │ testType (ENUM)       │
│ currentIteration     │         │ testFile              │
│ maxIterations        │         │ status (ENUM)         │
│ appUrl               │         │ results (JSONB)       │
│ techStack (JSONB)    │         │ failures (JSONB)      │
│ config (JSONB)       │         │ fixes (JSONB)         │
│ summary (JSONB)      │         │ duration              │
│ prUrl                │         │ createdAt             │
│ reportPrUrl          │         │ updatedAt             │
│ error                │         └──────────────────────┘
│ startedAt            │
│ completedAt          │           Relationship:
│ createdAt            │           AgentRun 1 ──── ∞ TestResult
│ updatedAt            │           (one run has many test results)
└──────────────────────┘
```

---

## 7. Status Lifecycle

The `status` field on `AgentRun` transitions through these states during the pipeline:

```
pending → cloning → installing → configuring → analyzing → generating
  → starting-app → testing → fixing → creating-pr → completed
                                                   ↘ failed
                                                   ↘ stopped
```

| Status | Description | When |
|--------|-------------|------|
| `pending` | Run created, not yet started | Step 1 |
| `cloning` | Acquiring repository (local workspace or clone) | Step 2 |
| `installing` | Installing project dependencies | Step 3 |
| `configuring` | Resolving environment variables | Step 4 |
| `analyzing` | AI analyzing the codebase (3-layer scan) | Step 6 |
| `generating` | AI generating Playwright test suites | Step 7 |
| `starting-app` | Auto-starting the target application | Step 8 |
| `testing` | Running Playwright tests | Step 9a |
| `fixing` | AI generating and applying fixes | Step 9d–h |
| `creating-pr` | Pushing branch and creating Pull Requests | Step 11 |
| `completed` | Pipeline finished (all passed or partial) | Step 12 |
| `failed` | Pipeline errored out | On exception |
| `stopped` | Manually stopped via API | Via POST /stop |

---

## 8. Agent Pipeline — 13-Step Flow

```
Step  1: Create run record                         (pending)
Step  2: Acquire repo                               (cloning)
         ├── CLI: useLocalWorkspace($GITHUB_WORKSPACE)
         └── API: cloneRepo(repoUrl)
         → createBranch('ignis/fix-<runId>')
Step  3: Install dependencies                       (installing)
         → detectPackageManager → installDependencies → installPlaywrightBrowsers
Step  4: Resolve environment                        (configuring)
         → detectRequiredEnvVars → resolveEnvironment → writeEnvFile
Step  5: Detect tech stack
         → StackDetector.detect() + manual overrides
Step  6: Analyze codebase                           (analyzing)
         → Layer 1: structureScan (no AI)
         → Layer 2: surfaceAnalysis (lightweight AI)
         → Layer 3: deepDive (targeted AI)
Step  7: Generate test suites                       (generating)
         → TestGenerator.generateAll() per test type
         → TestGenerator.generatePlaywrightConfig()
Step  8: Start target application                   (starting-app)
         → AppLauncher.startApp() — 3 retries
         → Fallback: disable E2E/visual if app won't start
Step  9: ITERATION LOOP (max = config.maxIterations)
         a. Run ALL tests                           (testing)
         b. All pass? → break
         c. At max? → break with partial
         d. Root-cause analysis                     (fixing)
         e. Generate fixes (app code + test code)
         f. Validate each fix (guardrails)
         g. Full regression re-run
         h. Commit validated fixes (separate commits)
         i. Increment → continue
Step 10: Stop target application
Step 11: Create Pull Request(s)                     (creating-pr)
         → Push branch → Create fix PR
         → If failures remain → Create report-only PR
Step 12: Build summary + update record              (completed)
Step 13: Cleanup
         → API: remove cloned directory
         → CLI: leave workspace (Actions handles cleanup)
```

---

## 9. Core Modules Reference

### RepoManager

| Method | Description |
|--------|-------------|
| `useLocalWorkspace(workDir)` | PRIMARY: Use actions/checkout workspace |
| `cloneRepo(repoUrl, workDir, token)` | SECONDARY: Clone with PAT auth |
| `createBranch(branchName)` | Create `ignis/fix-<runId>` |
| `commitChanges(message, files)` | Stage + commit specific files |
| `pushBranch(branchName)` | Push to origin |
| `createPR({ title, body, head, base })` | Create PR in same repo |
| `getChangedFiles()` | List modified/new files |
| `cleanup()` | Remove workspace (API mode) |

### DependencyInstaller

| Method | Description |
|--------|-------------|
| `detectPackageManager(workDir)` | Returns `npm` / `yarn` / `pnpm` / `pip` / `pipenv` / `null` |
| `installDependencies(workDir, pm)` | Run correct install (e.g., `npm ci`, `yarn install --frozen-lockfile`) |
| `installPlaywrightBrowsers(workDir)` | `npx playwright install --with-deps chromium` |
| `verifyInstallation(workDir)` | Check `node_modules` exists |

### EnvHandler

| Method | Description |
|--------|-------------|
| `detectRequiredEnvVars(workDir)` | Parse `.env.example`, `docker-compose.yml`, source `process.env.*` refs |
| `resolveEnvironment(workDir, secrets)` | Priority: provided > .env > .env.example > auto-mock |
| `generateMockValue(key)` | Smart defaults: DB URLs, secrets, tokens, ports |
| `writeEnvFile(workDir, envMap)` | Write `.env` to target app root |

### StackDetector

| Method | Description |
|--------|-------------|
| `detect(workDir, overrides)` | Returns `TechStack` object with frontend/backend/db/language |

### CodeAnalyzer

| Method | Description |
|--------|-------------|
| `structureScan(workDir)` | Layer 1: file tree, stats, config files (no AI) |
| `surfaceAnalysis(workDir, structure)` | Layer 2: routes, endpoints, components, models + lightweight AI |
| `deepDive(workDir, surface)` | Layer 3: full content of critical files + comprehensive AI analysis |
| `analyze(workDir)` | Full pipeline: L1 → L2 → L3 |

### TestGenerator

| Method | Description |
|--------|-------------|
| `generateAll(workDir, analysis, types, stack)` | Generate all test types + config |
| `generate(workDir, analysis, type, stack)` | Generate for a single test type |
| `generatePlaywrightConfig(outputDir, stack, types)` | Tailored `playwright.config.js` |

### TestRunner

| Method | Description |
|--------|-------------|
| `runTests(workDir, config)` | Execute `npx playwright test --reporter=json` |
| `parseResults(jsonReport, exitCode)` | Parse JSON reporter → structured result |
| `categorizeFailures(failures)` | Classify: frontend / backend / test / environment |
| `runSpecificTests(workDir, files, config)` | Run specific test files (for fix validation) |

### AppLauncher

| Method | Description |
|--------|-------------|
| `startApp(workDir, techStack, config)` | Full startup (3 retries + fallback) |
| `killApp()` | SIGTERM → wait → SIGKILL (or docker-compose down) |
| `getUrl()` | Return the app URL once started |

### IssueFixer

| Method | Description |
|--------|-------------|
| `analyzeFailures(testResults, analysis, workDir)` | Categorize + send to AI |
| `generateAndApplyFixes(analysis, workDir, config)` | Generate, apply, validate per-fix |
| `validateAllFixes(workDir, prevPassCount, config)` | Full regression check |
| `revertBatch(backups)` | Revert all fixes from a batch |

---

## 10. AI Provider Interface

All three providers implement the same abstract interface:

```
BaseAIProvider
├── analyzeCode(codeContext)              → Analysis + testing strategy
├── generateTests(analysis, type, stack)  → { files: [{ path, content }] }
├── analyzeFailures(results, sourceCode)  → Failure analysis + categories
└── generateFix(analysis, sourceCode)     → [{ file, originalCode, fixedCode, explanation }]
```

| Provider | SDK | Default Model | Context Window |
|----------|-----|---------------|----------------|
| Claude | `@anthropic-ai/sdk` | `claude-sonnet-4-20250514` | ~180K tokens |
| OpenAI | `openai` | `gpt-4-turbo` | ~120K tokens |
| Gemini | `@google/generative-ai` | `gemini-1.5-pro` | ~1M tokens |

---

## 11. CLI Mode (GitHub Actions — Primary)

The CLI is the **primary** entry point. It reads all config from environment variables:

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `REPO_PATH` | `$GITHUB_WORKSPACE` | Local checkout path (same repo) |
| `REPO_BRANCH` | `main` | Branch to test |
| `AI_PROVIDER` | `claude` | AI provider |
| `AI_API_KEY` | *(required)* | API key |
| `MAX_ITERATIONS` | `3` | Fix cycle limit |
| `TEST_TYPES` | `e2e,api,visual,accessibility,performance` | Test types |
| `APP_URL` | *(optional)* | Running app URL |
| `AUTO_START_APP` | `true` | Auto-start app |
| `APP_START_COMMAND` | *(auto-detected)* | Custom start command |
| `APP_SECRETS` | *(optional)* | JSON string of env vars |
| `GITHUB_TOKEN` | *(auto-provided)* | For PR creation |

**Exit Codes:**
- `0` — All tests passed (or fixes PR created successfully)
- `1` — Failures remain at max iterations, or pipeline error

**Outputs:**
- `$GITHUB_STEP_SUMMARY` — Formatted Markdown table for GitHub Actions UI
- `test-results/ignis-summary.json` — Machine-readable summary artifact

---

## 12. GitHub Action Inputs

The `action.yml` composite action accepts these inputs:

| Input | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `branch` | string | No | `main` | Branch to test |
| `ai-provider` | string | No | `claude` | `claude`, `openai`, `gemini` |
| `ai-api-key` | string | **Yes** | — | AI provider API key |
| `max-iterations` | string | No | `3` | Max fix cycles |
| `test-types` | string | No | all 5 | Comma-separated |
| `app-url` | string | No | — | If app is already running |
| `auto-start-app` | string | No | `true` | Auto-start app |
| `app-start-command` | string | No | — | Custom start command |
| `tech-stack-override` | string | No | — | JSON override |
| `app-secrets` | string | No | — | JSON env vars |

---

## 13. Dummy Data & Sample Payloads

### 13.1 Sample API Request/Response Flows

#### Flow A: Start a run, poll, get result

**1. Start:**

```http
POST /agent/run HTTP/1.1
Host: localhost:4000
Content-Type: application/json
x-api-key: ignis-secret-key-123

{
  "repoUrl": "https://github.com/acme/e-commerce-app",
  "branch": "develop",
  "aiProvider": "claude",
  "maxIterations": 3,
  "testTypes": ["e2e", "api", "accessibility"],
  "autoStartApp": true,
  "appSecrets": {
    "DATABASE_URL": "postgresql://admin:password@localhost:5432/ecommerce",
    "STRIPE_SECRET_KEY": "sk_test_abc123",
    "JWT_SECRET": "my-jwt-secret-key",
    "REDIS_URL": "redis://localhost:6379"
  }
}
```

**Response:**

```json
{
  "runId": "d4e5f6a7-b8c9-0123-def4-567890abcdef",
  "status": "pending",
  "message": "Agent run started. Poll GET /agent/runs/:id for status."
}
```

**2. Poll (during execution):**

```http
GET /agent/runs/d4e5f6a7-b8c9-0123-def4-567890abcdef HTTP/1.1
```

```json
{
  "runId": "d4e5f6a7-b8c9-0123-def4-567890abcdef",
  "status": "testing",
  "repoUrl": "https://github.com/acme/e-commerce-app",
  "startedAt": "2026-04-09T14:00:00.000Z",
  "summary": null
}
```

**3. Poll (after completion):**

```json
{
  "runId": "d4e5f6a7-b8c9-0123-def4-567890abcdef",
  "status": "completed",
  "repoUrl": "https://github.com/acme/e-commerce-app",
  "startedAt": "2026-04-09T14:00:00.000Z",
  "summary": {
    "runId": "d4e5f6a7-b8c9-0123-def4-567890abcdef",
    "status": "partial",
    "iterations": 3,
    "maxIterations": 3,
    "testResults": {
      "passed": 25,
      "failed": 3,
      "total": 28
    },
    "iterationHistory": [
      { "iteration": 1, "total": 28, "passed": 18, "failed": 10, "appFixes": 5, "testFixes": 2, "reverted": 1 },
      { "iteration": 2, "total": 28, "passed": 23, "failed": 5,  "appFixes": 3, "testFixes": 0, "reverted": 0 },
      { "iteration": 3, "total": 28, "passed": 25, "failed": 3,  "appFixes": 1, "testFixes": 1, "reverted": 1 }
    ],
    "appStarted": true,
    "appStartMethod": "auto-started",
    "prUrl": "https://github.com/acme/e-commerce-app/pull/87",
    "reportPrUrl": null,
    "duration": 312500,
    "techStack": {
      "frontend": "nextjs",
      "backend": "express",
      "language": "typescript"
    }
  }
}
```

#### Flow B: Minimal request (all defaults)

```http
POST /agent/run HTTP/1.1
Content-Type: application/json

{
  "repoUrl": "https://github.com/user/simple-api"
}
```

```json
{
  "runId": "11223344-5566-7788-9900-aabbccddeeff",
  "status": "pending",
  "message": "Agent run started. Poll GET /agent/runs/:id for status."
}
```

#### Flow C: Stop a running agent

```http
POST /agent/runs/d4e5f6a7-b8c9-0123-def4-567890abcdef/stop HTTP/1.1
```

```json
{
  "runId": "d4e5f6a7-b8c9-0123-def4-567890abcdef",
  "status": "stopped"
}
```

---

### 13.2 Sample AgentRun Records

#### Record A: Successful run (all tests passed in 2 iterations)

```json
{
  "id": "aaaa1111-bbbb-cccc-dddd-eeee11111111",
  "repoUrl": "https://github.com/acme/web-app",
  "branch": "main",
  "status": "completed",
  "currentIteration": 2,
  "maxIterations": 3,
  "appUrl": "http://localhost:3000",
  "techStack": {
    "frontend": { "framework": "react", "version": "18.2.0", "startCommand": "npm start", "port": 3000 },
    "backend": { "framework": "express", "version": "4.18.2", "startCommand": "node server/index.js", "port": 8080 },
    "database": { "type": "postgresql" },
    "language": "typescript",
    "monorepo": false,
    "packageManager": "npm"
  },
  "summary": {
    "status": "all-passed",
    "iterations": 2,
    "testResults": { "passed": 28, "failed": 0, "total": 28 },
    "prUrl": "https://github.com/acme/web-app/pull/42",
    "duration": 185200
  },
  "prUrl": "https://github.com/acme/web-app/pull/42",
  "reportPrUrl": null,
  "error": null,
  "startedAt": "2026-04-09T10:15:30.000Z",
  "completedAt": "2026-04-09T10:18:35.200Z"
}
```

#### Record B: Partial fix (3 failures remain after max iterations)

```json
{
  "id": "bbbb2222-cccc-dddd-eeee-ffff22222222",
  "repoUrl": "https://github.com/acme/legacy-app",
  "branch": "develop",
  "status": "completed",
  "currentIteration": 3,
  "maxIterations": 3,
  "appUrl": "http://localhost:5000",
  "techStack": {
    "frontend": { "framework": "angular", "version": "16.0.0", "port": 4200 },
    "backend": { "framework": "nestjs", "version": "10.0.0", "port": 5000 },
    "language": "typescript",
    "packageManager": "yarn"
  },
  "summary": {
    "status": "partial",
    "iterations": 3,
    "testResults": { "passed": 35, "failed": 3, "total": 38 },
    "prUrl": "https://github.com/acme/legacy-app/pull/156",
    "duration": 420800
  },
  "prUrl": "https://github.com/acme/legacy-app/pull/156",
  "reportPrUrl": null,
  "error": null,
  "startedAt": "2026-04-09T11:00:00.000Z",
  "completedAt": "2026-04-09T11:07:00.800Z"
}
```

#### Record C: Failed run (app wouldn't start)

```json
{
  "id": "cccc3333-dddd-eeee-ffff-000033333333",
  "repoUrl": "https://github.com/acme/broken-service",
  "branch": "main",
  "status": "failed",
  "currentIteration": 0,
  "maxIterations": 3,
  "appUrl": null,
  "techStack": null,
  "summary": {
    "status": "failed",
    "error": "Dependency installation failed (exit code 1): npm ERR! peer dep missing: react@^18",
    "duration": 45000
  },
  "prUrl": null,
  "reportPrUrl": null,
  "error": "Dependency installation failed (exit code 1): npm ERR! peer dep missing: react@^18",
  "startedAt": "2026-04-09T12:00:00.000Z",
  "completedAt": "2026-04-09T12:00:45.000Z"
}
```

---

### 13.3 Sample TestResult Records

#### Full set for one iteration

```json
[
  {
    "id": "tr-001",
    "runId": "aaaa1111-bbbb-cccc-dddd-eeee11111111",
    "iteration": 1,
    "testType": "e2e",
    "testFile": "e2e/login.spec.js",
    "status": "failed",
    "results": { "testName": "login form submits correctly", "duration": 3200 },
    "failures": {
      "error": "Expected button [data-testid='submit'] to be visible",
      "stackTrace": "at e2e/login.spec.js:24:28",
      "category": "frontend"
    },
    "fixes": {
      "file": "src/components/LoginForm.jsx",
      "originalCode": "<button type=\"button\"",
      "fixedCode": "<button type=\"submit\"",
      "explanation": "Button type was 'button' instead of 'submit'"
    },
    "duration": 3200
  },
  {
    "id": "tr-002",
    "runId": "aaaa1111-bbbb-cccc-dddd-eeee11111111",
    "iteration": 1,
    "testType": "e2e",
    "testFile": "e2e/dashboard.spec.js",
    "status": "passed",
    "results": { "testName": "dashboard loads user data", "duration": 2100 },
    "failures": null,
    "fixes": null,
    "duration": 2100
  },
  {
    "id": "tr-003",
    "runId": "aaaa1111-bbbb-cccc-dddd-eeee11111111",
    "iteration": 1,
    "testType": "api",
    "testFile": "api/auth-api.spec.js",
    "status": "failed",
    "results": { "testName": "POST /api/login returns token", "duration": 890 },
    "failures": {
      "error": "Expected status 200 but received 500",
      "stackTrace": "at api/auth-api.spec.js:18:5",
      "category": "backend"
    },
    "fixes": {
      "file": "src/api/routes/auth.js",
      "originalCode": "const user = await User.findOne(email);",
      "fixedCode": "const user = await User.findOne({ where: { email } });",
      "explanation": "Sequelize findOne requires a where clause object"
    },
    "duration": 890
  },
  {
    "id": "tr-004",
    "runId": "aaaa1111-bbbb-cccc-dddd-eeee11111111",
    "iteration": 1,
    "testType": "api",
    "testFile": "api/users-api.spec.js",
    "status": "passed",
    "results": { "testName": "GET /api/users returns list", "duration": 340 },
    "failures": null,
    "fixes": null,
    "duration": 340
  },
  {
    "id": "tr-005",
    "runId": "aaaa1111-bbbb-cccc-dddd-eeee11111111",
    "iteration": 1,
    "testType": "accessibility",
    "testFile": "accessibility/a11y.spec.js",
    "status": "failed",
    "results": { "testName": "login page passes a11y scan", "duration": 7500 },
    "failures": {
      "error": "2 accessibility violations: images-alt, color-contrast",
      "stackTrace": "at accessibility/a11y.spec.js:12",
      "category": "frontend"
    },
    "fixes": {
      "file": "src/pages/Login.jsx",
      "originalCode": "<img src=\"/logo.png\" />",
      "fixedCode": "<img src=\"/logo.png\" alt=\"Company Logo\" />",
      "explanation": "Added alt text to satisfy WCAG images-alt rule"
    },
    "duration": 7500
  },
  {
    "id": "tr-006",
    "runId": "aaaa1111-bbbb-cccc-dddd-eeee11111111",
    "iteration": 1,
    "testType": "performance",
    "testFile": "performance/performance.spec.js",
    "status": "passed",
    "results": { "testName": "homepage LCP under 2.5s", "duration": 4200, "lcp": 1800, "fid": 45, "cls": 0.02 },
    "failures": null,
    "fixes": null,
    "duration": 4200
  }
]
```

---

### 13.4 Sample Orchestrator Summary

#### All tests passed

```json
{
  "runId": "aaaa1111-bbbb-cccc-dddd-eeee11111111",
  "status": "all-passed",
  "iterations": 2,
  "maxIterations": 3,
  "testResults": {
    "passed": 28,
    "failed": 0,
    "total": 28
  },
  "iterationHistory": [
    {
      "iteration": 1,
      "total": 28,
      "passed": 20,
      "failed": 8,
      "appFixes": 4,
      "testFixes": 1,
      "reverted": 0
    },
    {
      "iteration": 2,
      "total": 28,
      "passed": 28,
      "failed": 0,
      "appFixes": 2,
      "testFixes": 1,
      "reverted": 0
    }
  ],
  "appStarted": true,
  "appStartMethod": "auto-started",
  "prUrl": "https://github.com/acme/web-app/pull/42",
  "reportPrUrl": null,
  "duration": 185200,
  "techStack": {
    "frontend": "react",
    "backend": "express",
    "language": "typescript"
  }
}
```

#### Failed run

```json
{
  "runId": "cccc3333-dddd-eeee-ffff-000033333333",
  "status": "failed",
  "error": "Dependency installation failed (exit code 1): npm ERR! Could not resolve dependency",
  "duration": 45000,
  "iterations": 0,
  "iterationHistory": []
}
```

---

### 13.5 Sample PR Body Output

```markdown
## IGNIS Automation Test Agent Report

### Run Summary
- **Run ID**: `aaaa1111-bbbb-cccc-dddd-eeee11111111`
- **Iterations**: 2/3
- **Final Status**: ✅ All tests passing
- **AI Provider**: claude
- **Mode**: Fully autonomous (zero user intervention)
- **Duration**: 185.2s

### Environment
- **App Startup**: Auto-started (auto-started)
- **Environment Variables**: 4 provided, 2 auto-generated

### Test Results (Final Iteration)

| Metric | Count |
|--------|-------|
| Passed | 28 |
| Failed | 0 |
| Skipped | 0 |
| Total | 28 |

### Application Code Fixes
1. `src/components/LoginForm.jsx`
2. `src/api/routes/auth.js`
3. `src/middleware/cors.js`
4. `src/pages/Login.jsx`
5. `src/api/routes/users.js`
6. `src/utils/validation.js`

### Test Code Fixes
1. `generated-tests/e2e/login.spec.js`
2. `generated-tests/api/auth-api.spec.js`

### Iteration History

| # | Total | Passed | Failed | App Fixes | Test Fixes | Reverted |
|---|-------|--------|--------|-----------|------------|----------|
| 1 | 28    | 20     | 8      | 4         | 1          | 0        |
| 2 | 28    | 28     | 0      | 2         | 1          | 0        |

---
*Generated by IGNIS Automation Test Agent*
```

---

### 13.6 Sample GitHub Step Summary

When running in GitHub Actions, the summary is written to `$GITHUB_STEP_SUMMARY` and looks like this in the Actions UI:

```markdown
## IGNIS Automation Test Agent Report

### Run Summary
- **Run ID**: `d4e5f6a7-b8c9-0123-def4-567890abcdef`
- **Iterations**: 3/3
- **Final Status**: ⚠️ Partial fixes applied
- **AI Provider**: claude
- **Mode**: Fully autonomous (zero user intervention)
- **Duration**: 312.5s

### Test Results (Final Iteration)

| Metric | Count |
|--------|-------|
| Passed | 25 |
| Failed | 3 |
| Skipped | 0 |
| Total | 28 |

### Iteration History

| # | Total | Passed | Failed | App Fixes | Test Fixes | Reverted |
|---|-------|--------|--------|-----------|------------|----------|
| 1 | 28    | 18     | 10     | 5         | 2          | 1        |
| 2 | 28    | 23     | 5      | 3         | 0          | 0        |
| 3 | 28    | 25     | 3      | 1         | 1          | 1        |

### Remaining Issues

| Test | Error | Category |
|------|-------|----------|
| `checkout flow completes` | Timeout waiting for payment confirmation | backend |
| `admin panel accessible` | Missing role check on /admin route | backend |
| `visual regression - cart page` | Screenshot diff above threshold | test |

---
*Generated by IGNIS Automation Test Agent*
```

---

### 13.7 Sample Tech Stack Detection

#### Input: React + Express + TypeScript monorepo

```json
{
  "frontend": {
    "framework": "react",
    "version": "18.2.0",
    "entryPoint": "src/index.tsx",
    "startCommand": "npm run dev",
    "port": 3000
  },
  "backend": {
    "framework": "express",
    "version": "4.18.2",
    "entryPoint": "server/index.js",
    "startCommand": "node server/index.js",
    "port": 8080
  },
  "database": {
    "type": "postgresql"
  },
  "language": "typescript",
  "monorepo": false,
  "packageManager": "npm"
}
```

#### Input: Next.js full-stack app

```json
{
  "frontend": {
    "framework": "nextjs",
    "version": "14.1.0",
    "entryPoint": "app/page.tsx",
    "startCommand": "npm run dev",
    "port": 3000
  },
  "backend": null,
  "database": {
    "type": "postgresql"
  },
  "language": "typescript",
  "monorepo": false,
  "packageManager": "pnpm"
}
```

#### Input: Python Django + Vue SPA

```json
{
  "frontend": {
    "framework": "vue",
    "version": "3.3.4",
    "startCommand": "npm run serve",
    "port": 8080
  },
  "backend": {
    "framework": "django",
    "startCommand": "python manage.py runserver",
    "port": 8000
  },
  "database": {
    "type": "postgresql"
  },
  "language": "python",
  "monorepo": false,
  "packageManager": "pip"
}
```

---

### 13.8 Sample Environment Resolution

#### Input

Given a repo with `.env.example`:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb
JWT_SECRET=change-me
REDIS_URL=redis://localhost:6379
PORT=3000
STRIPE_KEY=
SENDGRID_API_KEY=
```

And provided secrets:

```json
{
  "DATABASE_URL": "postgresql://admin:real-password@db.prod.internal:5432/ecommerce",
  "STRIPE_KEY": "sk_live_abc123"
}
```

#### Output: resolved .env

```
# Auto-generated by IGNIS Automation Test Agent
DATABASE_URL=postgresql://admin:real-password@db.prod.internal:5432/ecommerce
JWT_SECRET=change-me
REDIS_URL=redis://localhost:6379
PORT=3000
STRIPE_KEY=sk_live_abc123
SENDGRID_API_KEY=mock_sendgrid_api_key_a1b2c3d4e5f6
NODE_ENV=test
```

#### Resolution sources

```json
{
  "DATABASE_URL": "provided",
  "JWT_SECRET": ".env.example",
  "REDIS_URL": ".env.example",
  "PORT": ".env.example",
  "STRIPE_KEY": "provided",
  "SENDGRID_API_KEY": "auto-generated",
  "NODE_ENV": "auto-generated"
}
```

---

### 13.9 Sample AI Provider Responses

#### Surface Analysis Response

```json
{
  "criticalFiles": [
    "src/pages/Login.jsx",
    "src/pages/Dashboard.jsx",
    "src/api/routes/auth.js",
    "src/api/routes/users.js",
    "src/middleware/auth.js",
    "src/components/ProductCard.jsx",
    "src/components/Cart.jsx"
  ],
  "appType": "full-stack e-commerce web application",
  "testingPriorities": [
    "Authentication flow (login/register/logout)",
    "Product listing and search",
    "Shopping cart and checkout",
    "User profile management",
    "API endpoint validation"
  ],
  "userFlows": [
    "User registers → logs in → browses products → adds to cart → checks out",
    "Admin logs in → manages products → views orders",
    "Guest user browses → searches → views product details"
  ]
}
```

#### Test Generation Response

```json
{
  "files": [
    {
      "path": "e2e/login.spec.js",
      "content": "const { test, expect } = require('@playwright/test');\n\ntest.describe('Login Flow', () => {\n  test('should login with valid credentials', async ({ page }) => {\n    await page.goto('/login');\n    await page.fill('[data-testid=\"email\"]', 'user@example.com');\n    await page.fill('[data-testid=\"password\"]', 'password123');\n    await page.click('[data-testid=\"submit\"]');\n    await expect(page).toHaveURL('/dashboard');\n    await expect(page.locator('[data-testid=\"welcome\"]')).toBeVisible();\n  });\n\n  test('should show error for invalid credentials', async ({ page }) => {\n    await page.goto('/login');\n    await page.fill('[data-testid=\"email\"]', 'wrong@example.com');\n    await page.fill('[data-testid=\"password\"]', 'wrongpass');\n    await page.click('[data-testid=\"submit\"]');\n    await expect(page.locator('.error-message')).toHaveText('Invalid credentials');\n  });\n});"
    },
    {
      "path": "api/auth-api.spec.js",
      "content": "const { test, expect } = require('@playwright/test');\n\ntest.describe('Auth API', () => {\n  test('POST /api/login returns token', async ({ request }) => {\n    const response = await request.post('/api/login', {\n      data: { email: 'user@example.com', password: 'password123' }\n    });\n    expect(response.status()).toBe(200);\n    const body = await response.json();\n    expect(body).toHaveProperty('token');\n  });\n});"
    }
  ]
}
```

#### Failure Analysis Response

```json
{
  "failures": [
    {
      "testName": "login form submits correctly",
      "category": "frontend",
      "rootCause": "The login form button has type='button' instead of type='submit', so clicking it doesn't trigger the form's onSubmit handler",
      "suggestedFix": "Change button type from 'button' to 'submit' in LoginForm.jsx",
      "fixType": "app-code",
      "confidence": 0.95
    },
    {
      "testName": "POST /api/login returns token",
      "category": "backend",
      "rootCause": "Sequelize findOne() is called without a where clause, causing a SQL error",
      "suggestedFix": "Change User.findOne(email) to User.findOne({ where: { email } })",
      "fixType": "app-code",
      "confidence": 0.98
    },
    {
      "testName": "homepage passes a11y scan",
      "category": "frontend",
      "rootCause": "Logo image is missing alt attribute, violating WCAG images-alt rule",
      "suggestedFix": "Add alt='Company Logo' to the img tag",
      "fixType": "app-code",
      "confidence": 0.99
    }
  ]
}
```

#### Fix Generation Response

```json
[
  {
    "file": "src/components/LoginForm.jsx",
    "originalCode": "<button type=\"button\" onClick={handleSubmit}>",
    "fixedCode": "<button type=\"submit\">",
    "explanation": "Changed button type to 'submit' so the form's onSubmit handler fires correctly"
  },
  {
    "file": "src/api/routes/auth.js",
    "originalCode": "const user = await User.findOne(email);",
    "fixedCode": "const user = await User.findOne({ where: { email } });",
    "explanation": "Sequelize findOne requires an options object with a where clause"
  },
  {
    "file": "src/pages/Login.jsx",
    "originalCode": "<img src=\"/logo.png\" />",
    "fixedCode": "<img src=\"/logo.png\" alt=\"Company Logo\" />",
    "explanation": "Added alt text to satisfy WCAG images-alt accessibility rule"
  }
]
```

---

### 13.10 Sample Test Runner Output

#### Parsed test result (from Playwright JSON reporter)

```json
{
  "passed": 20,
  "failed": 8,
  "skipped": 0,
  "total": 28,
  "duration": 45200,
  "exitCode": 1,
  "failures": [
    {
      "testName": "login form submits correctly",
      "file": "e2e/login.spec.js",
      "error": "Expected button [data-testid='submit'] to be visible",
      "stackTrace": "Error: expect(locator).toBeVisible()\n  at e2e/login.spec.js:24:28\n  at Object.<anonymous> (node_modules/@playwright/test/lib/worker/workerMain.js:123:7)",
      "category": "frontend"
    },
    {
      "testName": "POST /api/login returns token",
      "file": "api/auth-api.spec.js",
      "error": "Expected status 200 but received 500",
      "stackTrace": "Error: expect(received).toBe(expected)\n  Received: 500\n  at api/auth-api.spec.js:18:5",
      "category": "backend"
    },
    {
      "testName": "homepage passes a11y scan",
      "file": "accessibility/a11y.spec.js",
      "error": "2 accessibility violations found",
      "stackTrace": "AxeResults at accessibility/a11y.spec.js:12",
      "category": "frontend"
    }
  ],
  "allTests": [
    { "testName": "login form submits correctly", "file": "e2e/login.spec.js", "status": "failed", "duration": 3200 },
    { "testName": "dashboard loads after login", "file": "e2e/dashboard.spec.js", "status": "passed", "duration": 2100 },
    { "testName": "user can update profile", "file": "e2e/profile.spec.js", "status": "passed", "duration": 1800 },
    { "testName": "POST /api/login returns token", "file": "api/auth-api.spec.js", "status": "failed", "duration": 890 },
    { "testName": "GET /api/users returns list", "file": "api/users-api.spec.js", "status": "passed", "duration": 340 },
    { "testName": "homepage passes a11y scan", "file": "accessibility/a11y.spec.js", "status": "failed", "duration": 7500 },
    { "testName": "homepage LCP under 2.5s", "file": "performance/performance.spec.js", "status": "passed", "duration": 4200 }
  ]
}
```

---

### 13.11 Sample Issue Fixer Output

#### generateAndApplyFixes result

```json
{
  "applied": [
    {
      "file": "src/components/LoginForm.jsx",
      "originalCode": "<button type=\"button\" onClick={handleSubmit}>",
      "fixedCode": "<button type=\"submit\">",
      "explanation": "Changed button type to 'submit'",
      "validated": true
    },
    {
      "file": "src/api/routes/auth.js",
      "originalCode": "const user = await User.findOne(email);",
      "fixedCode": "const user = await User.findOne({ where: { email } });",
      "explanation": "Sequelize findOne requires where clause",
      "validated": true
    }
  ],
  "reverted": [
    {
      "file": "src/middleware/cors.js",
      "originalCode": "origin: '*'",
      "fixedCode": "origin: 'http://localhost:3000'",
      "explanation": "Restrict CORS origin",
      "reason": "Fix introduced new failures"
    }
  ]
}
```

---

## 14. Error Responses

All error responses follow this structure:

```json
{
  "error": "<error type or short message>",
  "message": "<detailed message (development only)>"
}
```

| HTTP Code | error | Cause |
|-----------|-------|-------|
| `400` | `repoUrl is required` | Missing required field |
| `400` | `Invalid configuration: ...` | Joi validation failure on request body |
| `400` | `Run already completed` | Trying to stop a terminal run |
| `401` | `Unauthorized — invalid or missing API key` | Auth failure |
| `404` | `Run not found` | Invalid runId |
| `500` | `Internal server error` | Unhandled exception (detail hidden in production) |

---

## 15. Environment Variables Reference

```bash
# ═══════════════════════════════════════════
# Server (API mode only)
# ═══════════════════════════════════════════
PORT=4000                          # API server port
IGNIS_API_KEY=                     # API authentication key (optional)

# ═══════════════════════════════════════════
# GitHub Authentication
# ═══════════════════════════════════════════
GITHUB_TOKEN=ghp_xxxxxxxxxxxx     # Personal Access Token
GITHUB_AUTH_METHOD=pat             # 'pat' or 'app'
GITHUB_APP_ID=                     # GitHub App ID (if authMethod is 'app')
GITHUB_PRIVATE_KEY=                # GitHub App private key
GITHUB_INSTALLATION_ID=            # GitHub App installation ID

# ═══════════════════════════════════════════
# AI Providers (set key for the one you use)
# ═══════════════════════════════════════════
AI_PROVIDER=claude                 # claude | openai | gemini
AI_API_KEY=                        # Universal key (works for any provider)
CLAUDE_API_KEY=                    # Anthropic-specific key
OPENAI_API_KEY=                    # OpenAI-specific key
GEMINI_API_KEY=                    # Google Gemini-specific key

# ═══════════════════════════════════════════
# Database (API mode only, optional)
# ═══════════════════════════════════════════
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=ignis_agent
POSTGRES_USER=postgres
POSTGRES_PASSWORD=

# ═══════════════════════════════════════════
# Agent Configuration
# ═══════════════════════════════════════════
MAX_ITERATIONS=3                   # Fix-and-retest cycle limit
TEST_TYPES=e2e,api,visual,accessibility,performance
REPO_BRANCH=main                   # Default branch to test
AGENT_TIMEOUT_MINUTES=30           # Overall timeout per run
AGENT_WORK_DIR=./workspace         # Clone directory (API mode)

# ═══════════════════════════════════════════
# Target Application
# ═══════════════════════════════════════════
APP_URL=                           # If app is already running
AUTO_START_APP=true                # Auto-start from repo
APP_START_COMMAND=                  # Custom start command
APP_PORT=                          # Target port override
APP_SECRETS=                       # JSON string of env vars

# ═══════════════════════════════════════════
# CLI Mode (GitHub Actions)
# ═══════════════════════════════════════════
REPO_PATH=                         # Overrides $GITHUB_WORKSPACE
TECH_STACK_OVERRIDE=               # JSON string override

# ═══════════════════════════════════════════
# Logging
# ═══════════════════════════════════════════
LOG_LEVEL=info                     # error | warn | info | debug
LOG_DIR=logs
```

---

## 16. File Structure

```
ignis-test-agent/
├── .env.example                      # All env vars documented
├── .gitignore
├── action.yml                        # GitHub composite action (PRIMARY)
├── Dockerfile                        # Playwright base image
├── package.json                      # Dependencies & scripts
├── README.md                         # Quick start guide
├── IGNIS-API-DOCUMENTATION.md        # This file
│
├── config/
│   └── agent-config.example.json     # Example JSON config
│
├── src/
│   ├── index.js                      # API server entry (SECONDARY)
│   ├── cli.js                        # CLI entry (PRIMARY)
│   │
│   ├── config/
│   │   ├── default.js                # Config from env vars
│   │   └── schema.js                 # Joi validation
│   │
│   ├── api/
│   │   ├── routes.js                 # REST API endpoints
│   │   └── middleware.js              # Auth, logging, errors
│   │
│   ├── core/
│   │   ├── agent-orchestrator.js     # 13-step main pipeline
│   │   ├── repo-manager.js           # Git/GitHub operations
│   │   ├── dependency-installer.js   # Auto-install deps
│   │   ├── env-handler.js            # Environment resolution
│   │   ├── stack-detector.js         # Tech stack detection
│   │   ├── code-analyzer.js          # 3-layer codebase analysis
│   │   ├── test-generator.js         # Playwright test generation
│   │   ├── test-runner.js            # Test execution + parsing
│   │   ├── app-launcher.js           # App startup (3 retries)
│   │   └── issue-fixer.js            # AI fix + guardrails
│   │
│   ├── ai/
│   │   ├── base-provider.js          # Abstract interface
│   │   ├── claude-provider.js        # Anthropic Claude
│   │   ├── openai-provider.js        # OpenAI GPT-4
│   │   ├── gemini-provider.js        # Google Gemini
│   │   └── provider-factory.js       # Provider factory
│   │
│   ├── models/
│   │   ├── index.js                  # Sequelize init
│   │   ├── agent-run.js              # AgentRun model
│   │   └── test-result.js            # TestResult model
│   │
│   └── utils/
│       ├── logger.js                 # Winston logger
│       └── github-client.js          # GitHub auth helpers
│
├── .github/
│   └── workflows/
│       ├── ignis-testing.yml         # Reusable workflow
│       └── example-caller.yml        # Example for user repos
│
└── tests/
    ├── unit/                         # Unit tests
    └── integration/                  # Integration tests
```

---

*IGNIS Automation Test Agent — Comprehensive API & Technical Documentation v1.0.0*
