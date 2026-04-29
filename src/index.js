'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const logger = require('./utils/logger');
const defaultConfig = require('./config/default');
const { validateConfig } = require('./config/schema');
const { initDatabase, syncDatabase, closeDatabase } = require('./models');
const routes = require('./api/routes');
const { requestLogger, authenticate, errorHandler } = require('./api/middleware');

async function startServer() {
  // Validate config
  let config;
  try {
    config = validateConfig(defaultConfig);
  } catch (err) {
    logger.error(`Configuration error: ${err.message}`);
    process.exit(1);
  }

  const app = express();
  const port = process.env.PORT || 4000;

  // Store config on app for route access
  app.set('config', config);

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(requestLogger);
  app.use(authenticate);

  // Routes
  app.use('/', routes);

  // Error handler (must be last)
  app.use(errorHandler);

  // Initialize database (optional — fails gracefully)
  try {
    const sequelize = initDatabase(config);
    if (sequelize) {
      await syncDatabase();
    }
  } catch (err) {
    logger.warn(`Database initialization failed (running without DB): ${err.message}`);
  }

  // Start server
  const server = app.listen(port, () => {
    logger.info(`IGNIS Automation Test Agent API server running on port ${port}`);
    logger.info(`Health check: http://localhost:${port}/health`);
    logger.info(`AI Provider: ${config.ai.provider}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await closeDatabase();
      logger.info('Server stopped');
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after 10s timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

startServer().catch(err => {
  logger.error(`Failed to start server: ${err.message}`);
  process.exit(1);
});
