'use strict';

const { DataTypes } = require('sequelize');

const TEST_TYPES = ['e2e', 'api', 'visual', 'accessibility', 'performance'];
const TEST_STATUSES = ['passed', 'failed', 'error', 'skipped'];

module.exports = (sequelize) => {
  const TestResult = sequelize.define('TestResult', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    runId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'agent_runs',
        key: 'id'
      }
    },
    iteration: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    testType: {
      type: DataTypes.ENUM(...TEST_TYPES),
      allowNull: false
    },
    testFile: {
      type: DataTypes.STRING,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM(...TEST_STATUSES),
      defaultValue: 'passed'
    },
    results: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    failures: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    fixes: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    tableName: 'test_results',
    timestamps: true
  });

  return TestResult;
};

module.exports.TEST_TYPES = TEST_TYPES;
module.exports.TEST_STATUSES = TEST_STATUSES;
