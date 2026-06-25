'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const AICostCalculator = require('../utils/ai-cost-calculator');

/**
 * Knowledge Base Manager — Tracks persistent cache across runs
 * 
 * Purpose:
 * - Store analysis results between runs to avoid re-analyzing
 * - Track token usage: full analysis vs. cached updates
 * - Enable token consumption optimization
 * - Provide visibility into knowledge base hits/misses
 * - Track estimated costs for AI API calls (Enterprise pricing)
 */
class KnowledgeBaseManager {
  constructor(config) {
    this.config = config;
    // kbDir must be resolved from the active target workspace for each run.
    // Using process cwd can point to /app in containers, which is not persisted
    // across workflow runs.
    this.kbDir = null;
    this.metadata = null;
    this.kbSource = 'fresh'; // 'cache' | 'fresh' | 'partial-update'
    this.tokenUsage = {
      estimated: 0,
      full_analysis: 0,
      cached_read: 0,
      partial_update: 0,
      actual: 0
    };
    
    // Initialize cost calculator with configured AI provider
    const aiProvider = config.ai?.provider || process.env.AI_PROVIDER || 'openai';
    this.costCalculator = new AICostCalculator(aiProvider);
    this.costData = {
      estimatedCost: 0,
      costBreakdown: null,
      currencySymbol: '$'
    };
  }

  /**
   * Load or initialize knowledge base
   * Returns: { source: 'cache'|'fresh'|'partial-update', kbData: {...} }
   */
  async loadOrInitialize(workDir, codeAnalysis) {
    this._setKbDir(workDir);
    logger.info('╔════════════════════════════════════════════════════════════╗');
    logger.info('║  KNOWLEDGE BASE MANAGER — Initialization                   ║');
    logger.info('╚════════════════════════════════════════════════════════════╝');

    try {
      // Compute current project hash
      const currentHash = await this._computeProjectHash(workDir);
      logger.debug(`[KB] Current project hash: ${currentHash.slice(0, 12)}...`);

      // Try to load existing KB
      const metadata = this._loadMetadata();
      
      if (!metadata) {
        logger.warn('[KB] ⚠️  No cached knowledge base found');
        return this._initializeFreshKB(workDir, currentHash);
      }

      // Check if hash matches (project unchanged)
      if (metadata.projectHash === currentHash) {
        logger.info(`[KB] ✅ Project hash matches (${currentHash.slice(0, 12)}...)`);
        logger.info('[KB] 📚 Loading from cache...');
        
        const kb = this._loadFullKB();
        this.kbSource = 'cache';
        this.tokenUsage.estimated = 0;  // No tokens used for cache read
        
        // Calculate cost savings
        const costComparison = this.costCalculator.estimateCostComparison();
        this.costData.estimatedCost = 0;
        this.costData.costBreakdown = {
          savedVsFull: costComparison.potentialSavingsPerRun,
          formattedSavings: costComparison.savingsFormattedPerRun,
          savingsPercent: costComparison.savingsPercentage
        };
        
        logger.info('[KB] ════════════════════════════════════════════════════════════');
        logger.info('[KB] SOURCE: CACHED KNOWLEDGE BASE');
        logger.info('[KB] TOKENS ESTIMATED: ~0 (cached read only)');
        logger.info('[KB] 💰 ESTIMATED COST: $0.00');
        logger.info(`[KB] 💵 COST SAVINGS: ${costComparison.savingsFormattedPerRun} vs full analysis (${costComparison.savingsPercentage}% reduction)`);
        logger.info('[KB] ════════════════════════════════════════════════════════════');
        logger.info('[KB] ✅ Cache hit: Using stored analysis results');
        logger.info(`[KB]    - Tech stack: ${JSON.stringify(kb.techStack).slice(0, 50)}...`);
        logger.info(`[KB]    - Endpoints cached: ${Object.keys(kb.apiCatalog || {}).length}`);
        logger.info(`[KB]    - Last updated: ${metadata.lastUpdatedDate}`);
        
        return { source: 'cache', kb };
      } else {
        logger.warn('[KB] ⚠️  Project hash mismatch (project changed)');
        logger.info(`[KB]    Stored hash: ${metadata.projectHash.slice(0, 12)}...`);
        logger.info(`[KB]    Current hash: ${currentHash.slice(0, 12)}...`);
        logger.info('[KB] ℹ️  Will perform fresh analysis...');
        
        return this._initializeFreshKB(workDir, currentHash);
      }
    } catch (err) {
      logger.warn(`[KB] Error loading KB: ${err.message}`);
      logger.info('[KB] Starting with fresh analysis...');
      return this._initializeFreshKB(workDir, null);
    }
  }

  /**
   * Initialize fresh KB with full token estimation
   */
  _initializeFreshKB(workDir, projectHash) {
    this.kbSource = 'fresh';
    
    // Estimate tokens for full analysis
    this.tokenUsage.estimated = 25000;  // Full analysis: ~25K tokens
    this.tokenUsage.full_analysis = 25000;
    
    // Calculate cost for full analysis (15K input, 10K output)
    const fullAnalysisCost = this.costCalculator.estimateFullAnalysisCost();
    this.costData.estimatedCost = fullAnalysisCost.estimated;
    this.costData.costBreakdown = fullAnalysisCost.breakdown;
    
    logger.info('[KB] ════════════════════════════════════════════════════════════');
    logger.info('[KB] SOURCE: FULL ANALYSIS (No cache available)');
    logger.info('[KB] TOKENS ESTIMATED: ~25,000 (full code analysis)');
    logger.info(`[KB] 💰 ESTIMATED COST: ${fullAnalysisCost.formattedCost} (${this.costCalculator.getModelDisplayName()})`);
    logger.info('[KB] ════════════════════════════════════════════════════════════');
    logger.info('[KB] 🔍 Performing complete code analysis:');
    logger.info('[KB]    - Tech stack detection: ~5K tokens');
    logger.info('[KB]    - Code structure analysis (3-layer): ~8K tokens');
    logger.info('[KB]    - API endpoint discovery: ~4K tokens');
    logger.info('[KB]    - Test pattern analysis: ~3K tokens');
    logger.info('[KB]    - Business logic extraction: ~5K tokens');
    
    const kb = {
      metadata: {
        projectHash: projectHash || 'unknown',
        lastAnalyzedCommit: null,
        lastUpdatedDate: new Date().toISOString(),
        analysisVersion: '2.0.0',
        cacheValid: false,
        source: 'fresh'
      },
      techStack: null,
      codeAnalysis: null,
      apiCatalog: {},
      testPatterns: {},
      coverageBaselines: {},
      failureHistory: {}
    };
    
    return { source: 'fresh', kb };
  }

  /**
   * Update KB with new analysis results.
   * When source is 'cache', only the fields that were explicitly provided are
   * overwritten — everything else is preserved from the existing cache files.
   * This ensures we never discard a valid knowledge base entry on a cache-hit run.
   */
  async updateKB(workDir, analysisResults) {
    try {
      this._setKbDir(workDir);
      logger.info('\n╔════════════════════════════════════════════════════════════╗');
      logger.info('║  KNOWLEDGE BASE — Updating Cache                           ║');
      logger.info('╚════════════════════════════════════════════════════════════╝');

      if (!fs.existsSync(this.kbDir)) {
        fs.mkdirSync(this.kbDir, { recursive: true });
      }

      // Determine if this is a partial update or full update
      // On cache-hit runs the orchestrator does NOT pass analysisResults (or passes only
      // a subset), so we treat any run that loaded from cache as a partial update.
      const isPartialUpdate = this.kbSource === 'cache';
      const estimatedTokens = isPartialUpdate ? 2000 : 25000;

      if (isPartialUpdate) {
        // Only write fields that were explicitly provided — keep the rest as-is.
        const provided = Object.keys(analysisResults || {});
        if (provided.length === 0) {
          logger.info('[KB] Cache-hit run: nothing new to write — KB unchanged');
          return this.metadata;
        }
        logger.info(`[KB] Partial update: refreshing [${provided.join(', ')}] only`);
      }

      // Update metadata
      const currentHash = await this._computeProjectHash(workDir);
      const metadata = {
        projectHash: currentHash,
        lastUpdatedDate: new Date().toISOString(),
        analysisVersion: '2.0.0',
        cacheValid: true,
        source: isPartialUpdate ? 'partial-update' : 'fresh',
        tokenUsage: {
          this_run: estimatedTokens,
          savings_potential: isPartialUpdate ? 23000 : 0
        }
      };

      fs.writeFileSync(
        path.join(this.kbDir, 'project-metadata.json'),
        JSON.stringify(metadata, null, 2)
      );

      // Save tech stack
      if (analysisResults.techStack) {
        fs.writeFileSync(
          path.join(this.kbDir, 'tech-stack-final.json'),
          JSON.stringify(analysisResults.techStack, null, 2)
        );
      }

      // Save code analysis
      if (analysisResults.codeAnalysis) {
        fs.writeFileSync(
          path.join(this.kbDir, 'code-analysis-cache.json'),
          JSON.stringify(analysisResults.codeAnalysis, null, 2)
        );
      }

      // Save API catalog
      if (analysisResults.apiDocumentation) {
        fs.writeFileSync(
          path.join(this.kbDir, 'api-endpoints-catalog.json'),
          JSON.stringify(analysisResults.apiDocumentation, null, 2)
        );
      }

      // Log update summary
      logger.info('[KB] ════════════════════════════════════════════════════════════');
      if (isPartialUpdate) {
        const partialCost = this.costCalculator.estimateCachedUpdateCost();
        const costComparison = this.costCalculator.estimateCostComparison();
        logger.info('[KB] OPERATION: PARTIAL UPDATE (using cached baseline)');
        logger.info('[KB] TOKENS ESTIMATED: ~2,000 (incremental updates only)');
        logger.info(`[KB] 💰 ESTIMATED COST: ${partialCost.formattedCost} (${this.costCalculator.getModelDisplayName()})`);
        logger.info(`[KB] 💵 SAVINGS: ${costComparison.savingsFormattedPerRun} vs full analysis (${costComparison.savingsPercentage}% reduction) ✅`);
      } else {
        const fullCost = this.costCalculator.estimateFullAnalysisCost();
        logger.info('[KB] OPERATION: FULL UPDATE (fresh analysis)');
        logger.info('[KB] TOKENS ESTIMATED: ~25,000 (complete analysis)');
        logger.info(`[KB] 💰 ESTIMATED COST: ${fullCost.formattedCost} (${this.costCalculator.getModelDisplayName()})`);
      }
      logger.info('[KB] ════════════════════════════════════════════════════════════');

      logger.info('[KB] ✅ Knowledge base updated:');
      logger.info(`[KB]    - Project hash: ${currentHash.slice(0, 12)}...`);
      logger.info(`[KB]    - Files saved: metadata, tech-stack, code-analysis, api-catalog`);
      logger.info(`[KB]    - Cache ready for next run`);

      this.metadata = metadata;
      return metadata;
    } catch (err) {
      logger.warn(`[KB] Failed to update KB: ${err.message}`);
    }
  }

  _setKbDir(workDir) {
    if (workDir && typeof workDir === 'string') {
      this.kbDir = path.join(workDir, '.ignis-kb');
      return;
    }

    // Fallback for non-standard invocations
    this.kbDir = path.join(process.cwd(), '.ignis-kb');
  }

  /**
   * Finalize token tracking for reports
   */
  finalizeTokenTracking(actualTokenUsage) {
    this.tokenUsage.actual = actualTokenUsage || this.tokenUsage.estimated;
    
    // Calculate savings
    const potentialTokens = this.kbSource === 'cache' ? 25000 : 0;
    const tokensSaved = potentialTokens - this.tokenUsage.actual;
    
    return {
      source: this.kbSource,
      estimated: this.tokenUsage.estimated,
      actual: this.tokenUsage.actual,
      saved: tokensSaved,
      cost_reduction: `${Math.round((tokensSaved / 25000) * 100)}%`
    };
  }

  /**
   * Get KB analytics for reports
   */
  getAnalytics() {
    return {
      kbSource: this.kbSource,
      tokenUsage: this.tokenUsage,
      cacheStatus: this.kbSource === 'cache' ? 'HIT' : 'MISS',
      cacheLocation: this.kbDir,
      lastMetadata: this.metadata
    };
  }

  /**
   * Compute hash of project (package.json + src structure)
   */
  async _computeProjectHash(workDir) {
    try {
      const hash = crypto.createHash('sha256');
      
      // Hash package.json
      const packageJsonPath = path.join(workDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        hash.update(content);
      }
      
      // Hash src directory structure + dependency count
      const srcPath = path.join(workDir, 'src');
      if (fs.existsSync(srcPath)) {
        const fileCount = this._countFiles(srcPath);
        hash.update(`files:${fileCount}`);
      }
      
      return hash.digest('hex');
    } catch (err) {
      logger.debug(`[KB] Error computing hash: ${err.message}`);
      return 'unknown';
    }
  }

  /**
   * Count files recursively
   */
  _countFiles(dir, maxDepth = 5, depth = 0) {
    if (depth > maxDepth) return 0;
    let count = 0;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        if (entry.isFile()) count++;
        else if (entry.isDirectory()) count += this._countFiles(path.join(dir, entry.name), maxDepth, depth + 1);
      }
    } catch {}
    return count;
  }

  /**
   * Load project metadata
   */
  _loadMetadata() {
    try {
      const metadataPath = path.join(this.kbDir, 'project-metadata.json');
      if (fs.existsSync(metadataPath)) {
        const content = fs.readFileSync(metadataPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (err) {
      logger.debug(`[KB] Error loading metadata: ${err.message}`);
    }
    return null;
  }

  /**
   * Load full knowledge base
   */
  _loadFullKB() {
    const kb = {
      metadata: this._loadMetadata() || {},
      techStack: this._loadJSON('tech-stack-final.json'),
      codeAnalysis: this._loadJSON('code-analysis-cache.json'),
      apiCatalog: this._loadJSON('api-endpoints-catalog.json'),
      testPatterns: this._loadJSON('test-patterns-learned.json'),
      coverageBaselines: this._loadJSON('coverage-baselines.json'),
      failureHistory: this._loadJSON('failures-history.json')
    };
    return kb;
  }

  /**
   * Load JSON file from KB directory
   */
  _loadJSON(filename) {
    try {
      const filePath = path.join(this.kbDir, filename);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (err) {
      logger.debug(`[KB] Error loading ${filename}: ${err.message}`);
    }
    return {};
  }

  /**
   * Get KB size for diagnostics
   */
  getKBSize() {
    try {
      let totalSize = 0;
      if (fs.existsSync(this.kbDir)) {
        const files = fs.readdirSync(this.kbDir);
        for (const file of files) {
          const filePath = path.join(this.kbDir, file);
          const stats = fs.statSync(filePath);
          totalSize += stats.size;
        }
      }
      return totalSize;
    } catch {
      return 0;
    }
  }

  /**
   * Clear KB cache (for testing)
   */
  clearCache() {
    try {
      if (fs.existsSync(this.kbDir)) {
        fs.rmSync(this.kbDir, { recursive: true, force: true });
        logger.info('[KB] ✅ Cache cleared');
      }
    } catch (err) {
      logger.warn(`[KB] Failed to clear cache: ${err.message}`);
    }
  }
}

module.exports = KnowledgeBaseManager;
