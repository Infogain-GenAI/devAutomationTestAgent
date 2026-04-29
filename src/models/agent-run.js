'use strict';

const { DataTypes } = require('sequelize');

const RUN_STATUSES = [
  'pending',
  'cloning',
  'installing',
  'configuring',
  'analyzing',
  'generating',
  'starting-app',
  'testing',
  'fixing',
  'creating-pr',
  'completed',
  'failed',
  'stopped'
];

module.exports = (sequelize) => {
  const AgentRun = sequelize.define('AgentRun', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    repoUrl: {
      type: DataTypes.STRING,
      allowNull: false
    },
    branch: {
      type: DataTypes.STRING,
      defaultValue: 'main'
    },
    status: {
      type: DataTypes.ENUM(...RUN_STATUSES),
      defaultValue: 'pending'
    },
    currentIteration: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    maxIterations: {
      type: DataTypes.INTEGER,
      defaultValue: 3
    },
    appUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    techStack: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    config: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    summary: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    prUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    reportPrUrl: {
      type: DataTypes.STRING,
      allowNull: true
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'agent_runs',
    timestamps: true
  });

  return AgentRun;
};

module.exports.RUN_STATUSES = RUN_STATUSES;
