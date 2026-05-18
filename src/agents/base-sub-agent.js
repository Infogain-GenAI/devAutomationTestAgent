'use strict';

const logger = require('../utils/logger');

/**
 * Base class for all sub-agents in the IGNIS pipeline.
 * Each sub-agent is independently executable and tracks its own iteration state.
 */
class BaseSubAgent {
  /**
   * @param {string} name - Sub-agent name (e.g., 'generation', 'validation', 'execution')
   * @param {object} config - Application configuration
   * @param {object} dependencies - Shared dependencies (AI provider, repo manager, etc.)
   */
  constructor(name, config, dependencies = {}) {
    if (new.target === BaseSubAgent) {
      throw new Error('BaseSubAgent is abstract and cannot be instantiated directly');
    }

    this.name = name;
    this.config = config;
    this.dependencies = dependencies;
    this.maxIterations = config.agent?.subAgentMaxIterations || 5;
    this.coverageThreshold = config.agent?.coverageThreshold || 95;
    this.currentIteration = 0;
    this.state = 'idle'; // idle | running | completed | failed
    this.result = null;
    this.iterationHistory = [];
    this.startTime = null;
  }

  /**
   * Execute the sub-agent's main logic with internal iteration loop.
   * Iterates until coverage criteria met or max iterations reached.
   * @param {object} context - Input context from previous sub-agent or pipeline
   * @returns {object} - Sub-agent result with status, coverage, artifacts
   */
  async execute(context) {
    this.startTime = Date.now();
    this.state = 'running';
    this.currentIteration = 0;
    this.iterationHistory = [];

    logger.info(`\n${'═'.repeat(60)}`);
    logger.info(`  SUB-AGENT: ${this.name.toUpperCase()}`);
    logger.info(`  Max Iterations: ${this.maxIterations} | Coverage Target: ${this.coverageThreshold}%`);
    logger.info(`${'═'.repeat(60)}\n`);

    let lastResult = null;

    try {
      // Initial run
      lastResult = await this._runIteration(context, 0);
      this.iterationHistory.push(this._buildIterationRecord(0, lastResult));

      // Internal iteration loop — iterate until coverage met or max reached
      while (this.currentIteration < this.maxIterations - 1) {
        if (this._isCoverageMet(lastResult)) {
          logger.info(`✅ [${this.name}] Coverage threshold met (${this._getCoverage(lastResult)}% >= ${this.coverageThreshold}%)`);
          break;
        }

        if (this._isComplete(lastResult)) {
          logger.info(`✅ [${this.name}] Sub-agent completed successfully`);
          break;
        }

        this.currentIteration++;
        logger.info(`\n── [${this.name}] Iteration ${this.currentIteration + 1}/${this.maxIterations} ──`);

        lastResult = await this._runIteration(context, this.currentIteration, lastResult);
        this.iterationHistory.push(this._buildIterationRecord(this.currentIteration, lastResult));
      }

      if (!this._isCoverageMet(lastResult) && !this._isComplete(lastResult)) {
        logger.warn(`⚠️ [${this.name}] Max iterations reached without meeting coverage target`);
      }

      this.result = this._buildFinalResult(lastResult);
      this.state = 'completed';

    } catch (err) {
      logger.error(`❌ [${this.name}] Failed: ${err.message}`);
      this.state = 'failed';
      this.result = {
        status: 'failed',
        error: err.message,
        iterations: this.currentIteration + 1,
        duration: Date.now() - this.startTime
      };
    }

    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    logger.info(`\n[${this.name}] Completed in ${duration}s | Status: ${this.state} | Iterations: ${this.currentIteration + 1}`);

    return this.result;
  }

  /**
   * Run a single iteration of the sub-agent.
   * MUST be implemented by subclasses.
   * @param {object} context - Pipeline context
   * @param {number} iteration - Current iteration index
   * @param {object} previousResult - Result from previous iteration (null for first)
   * @returns {object} - Iteration result
   */
  async _runIteration(context, iteration, previousResult = null) {
    throw new Error(`${this.name}._runIteration() must be implemented`);
  }

  /**
   * Check if coverage threshold is met.
   * Override in subclasses that track coverage.
   */
  _isCoverageMet(result) {
    if (!result || !result.coverage) return false;
    const coverage = typeof result.coverage === 'number' 
      ? result.coverage 
      : result.coverage.statements || result.coverage.lines || 0;
    return coverage >= this.coverageThreshold;
  }

  /**
   * Get coverage percentage from result.
   */
  _getCoverage(result) {
    if (!result || !result.coverage) return 0;
    return typeof result.coverage === 'number' 
      ? result.coverage 
      : result.coverage.statements || result.coverage.lines || 0;
  }

  /**
   * Check if the sub-agent's work is complete (non-coverage based).
   * Override in subclasses (e.g., generation agent completes when all files generated).
   */
  _isComplete(result) {
    return result && result.complete === true;
  }

  /**
   * Build an iteration record for history tracking.
   */
  _buildIterationRecord(iteration, result) {
    return {
      iteration,
      timestamp: new Date().toISOString(),
      coverage: this._getCoverage(result),
      status: result?.status || 'unknown',
      artifacts: result?.artifacts || [],
      issues: result?.issues || []
    };
  }

  /**
   * Build the final result object.
   * Override in subclasses for custom result structures.
   */
  _buildFinalResult(lastResult) {
    return {
      subAgent: this.name,
      status: this._isCoverageMet(lastResult) || this._isComplete(lastResult) ? 'success' : 'partial',
      iterations: this.currentIteration + 1,
      maxIterations: this.maxIterations,
      coverage: this._getCoverage(lastResult),
      coverageThreshold: this.coverageThreshold,
      coverageMet: this._isCoverageMet(lastResult),
      duration: Date.now() - this.startTime,
      iterationHistory: this.iterationHistory,
      result: lastResult
    };
  }

  /**
   * Get current state summary for logging/reporting.
   */
  getStateSummary() {
    return {
      name: this.name,
      state: this.state,
      iteration: this.currentIteration,
      maxIterations: this.maxIterations,
      coverageThreshold: this.coverageThreshold,
      duration: this.startTime ? Date.now() - this.startTime : 0
    };
  }
}

module.exports = BaseSubAgent;
