'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { validateConfig } = require('../config/schema');
const AgentOrchestrator = require('../core/agent-orchestrator');

const router = express.Router();

// In-memory store for active runs (API mode uses this + DB)
const activeRuns = new Map();

/**
 * POST /agent/run — Start a new agent run.
 * Returns immediately with runId; orchestrator runs async.
 */
router.post('/agent/run', async (req, res) => {
  try {
    const {
      repoUrl, branch, appUrl, maxIterations,
      aiProvider, testTypes, techStackOverride,
      appSecrets, autoStartApp, appStartCommand
    } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: 'repoUrl is required' });
    }

    // Build run-specific config
    const config = req.app.get('config');
    const runConfig = {
      ...config,
      agent: {
        ...config.agent,
        maxIterations: maxIterations || config.agent.maxIterations,
        branch: branch || config.agent.branch
      },
      ai: {
        ...config.ai,
        provider: aiProvider || config.ai.provider
      },
      testing: {
        ...config.testing,
        types: testTypes || config.testing.types
      },
      app: {
        ...config.app,
        url: appUrl || config.app.url,
        autoStart: autoStartApp !== undefined ? autoStartApp : config.app.autoStart,
        startCommand: appStartCommand || config.app.startCommand
      }
    };

    // Validate config
    try {
      validateConfig(runConfig);
    } catch (err) {
      return res.status(400).json({ error: `Invalid configuration: ${err.message}` });
    }

    const orchestrator = new AgentOrchestrator(runConfig);
    const runId = orchestrator.getRunId();

    activeRuns.set(runId, {
      orchestrator,
      startedAt: new Date(),
      repoUrl
    });

    // Start async — don't await
    orchestrator.run({
      repoUrl,
      branch,
      mode: 'api',
      techStackOverride,
      appSecrets,
      autoStartApp,
      appStartCommand,
      appUrl
    }).catch(err => {
      logger.error(`Run ${runId} failed: ${err.message}`);
    });

    res.status(202).json({
      runId,
      status: 'pending',
      message: 'Agent run started. Poll GET /agent/runs/:id for status.'
    });

  } catch (err) {
    logger.error(`Failed to start agent run: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /agent/runs — List all runs.
 */
router.get('/agent/runs', (req, res) => {
  const runs = [];
  for (const [runId, run] of activeRuns) {
    runs.push({
      runId,
      status: run.orchestrator.getStatus(),
      repoUrl: run.repoUrl,
      startedAt: run.startedAt,
      summary: run.orchestrator.getSummary()
    });
  }

  // Sort by startedAt desc
  runs.sort((a, b) => b.startedAt - a.startedAt);

  // Pagination
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const start = (page - 1) * limit;
  const paged = runs.slice(start, start + limit);

  res.json({
    total: runs.length,
    page,
    limit,
    runs: paged
  });
});

/**
 * GET /agent/runs/:id — Get run details.
 */
router.get('/agent/runs/:id', (req, res) => {
  const run = activeRuns.get(req.params.id);
  if (!run) {
    return res.status(404).json({ error: 'Run not found' });
  }

  res.json({
    runId: req.params.id,
    status: run.orchestrator.getStatus(),
    repoUrl: run.repoUrl,
    startedAt: run.startedAt,
    summary: run.orchestrator.getSummary()
  });
});

/**
 * POST /agent/runs/:id/stop — Stop a running agent.
 */
router.post('/agent/runs/:id/stop', (req, res) => {
  const run = activeRuns.get(req.params.id);
  if (!run) {
    return res.status(404).json({ error: 'Run not found' });
  }

  const status = run.orchestrator.getStatus();
  if (['completed', 'failed', 'stopped'].includes(status)) {
    return res.status(400).json({ error: `Run already ${status}` });
  }

  // Signal stop (orchestrator checks this flag between steps)
  run.orchestrator.status = 'stopped';
  logger.info(`Run ${req.params.id} stop requested`);

  res.json({ runId: req.params.id, status: 'stopped' });
});

/**
 * GET /agent/config — Get current config (sanitized).
 */
router.get('/agent/config', (req, res) => {
  const config = req.app.get('config');
  // Strip secrets
  const sanitized = {
    agent: config.agent,
    ai: { provider: config.ai.provider },
    testing: config.testing,
    app: config.app
  };
  res.json(sanitized);
});

/**
 * GET /health — Health check.
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ignis-test-agent',
    uptime: process.uptime(),
    activeRuns: activeRuns.size
  });
});

module.exports = router;
