'use strict';

const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');

let sequelize = null;

/**
 * Initialize Sequelize with PostgreSQL.
 * Returns null if database is not configured (CLI mode).
 */
function initDatabase(config) {
  if (!config.database || !config.database.password) {
    logger.info('Database not configured — running in memory-only mode (CLI)');
    return null;
  }

  sequelize = new Sequelize(
    config.database.name,
    config.database.user,
    config.database.password,
    {
      host: config.database.host,
      port: config.database.port,
      dialect: 'postgres',
      logging: (msg) => logger.debug(msg),
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    }
  );

  // Register models
  const AgentRun = require('./agent-run')(sequelize);
  const TestResult = require('./test-result')(sequelize);

  // Associations
  AgentRun.hasMany(TestResult, { foreignKey: 'runId', as: 'testResults' });
  TestResult.belongsTo(AgentRun, { foreignKey: 'runId', as: 'agentRun' });

  return sequelize;
}

async function syncDatabase(options = {}) {
  if (!sequelize) return;
  await sequelize.sync(options);
  logger.info('Database synced successfully');
}

async function closeDatabase() {
  if (!sequelize) return;
  await sequelize.close();
  logger.info('Database connection closed');
}

function getSequelize() {
  return sequelize;
}

module.exports = { initDatabase, syncDatabase, closeDatabase, getSequelize };
