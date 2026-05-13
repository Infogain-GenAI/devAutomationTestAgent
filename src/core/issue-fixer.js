'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const TestRunner = require('./test-runner');

class IssueFixer {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  /**
   * Analyze test failures and produce a fix plan.
   */
  async analyzeFailures(testResults, codeAnalysis, workDir) {
    logger.info(`Analyzing ${testResults.failures.length} failure(s)...`);

    // Categorize failures
    const categorized = TestRunner.categorizeFailures(testResults.failures);

    // Gather source code for the failing files (deduplicated)
    const sourceCode = {};
    const uniqueFiles = new Set();
    for (const failure of categorized) {
      if (!failure.file || uniqueFiles.has(failure.file)) continue;
      uniqueFiles.add(failure.file);
      
      // Try multiple locations for the test file
      const candidates = [
        path.join(workDir, 'generated-tests', failure.file),
        path.join(workDir, failure.file),
        failure.file // absolute path
      ];
      
      for (const testFilePath of candidates) {
        if (fs.existsSync(testFilePath)) {
          try {
            sourceCode[`test:${failure.file}`] = fs.readFileSync(testFilePath, 'utf-8');
          } catch {}
          break;
        }
      }
    }

    // Include key source files from analysis
    if (codeAnalysis?.analysis?.analyzedFiles) {
      for (const file of codeAnalysis.analysis.analyzedFiles.slice(0, 10)) {
        const fullPath = path.join(workDir, file);
        if (fs.existsSync(fullPath)) {
          try {
            sourceCode[`app:${file}`] = fs.readFileSync(fullPath, 'utf-8');
          } catch {
            // Skip unreadable
          }
        }
      }
    }

    // Estimate content size to decide whether to chunk
    const estimatedSize = JSON.stringify({ failures: categorized, sourceCode }).length;
    const CHUNK_THRESHOLD = 100000; // 100k chars — below OpenAI's 120k limit with headroom

    if (estimatedSize <= CHUNK_THRESHOLD || categorized.length <= 10) {
      // Small enough — single analysis call
      const failureAnalysis = await this.aiProvider.analyzeFailures(
        { failures: categorized, passCount: testResults.passed, failCount: testResults.failed },
        sourceCode
      );
      return { failures: categorized, analysis: failureAnalysis, sourceCode };
    }

    // ── Chunked analysis: split failures into manageable batches ──
    logger.info(`Content too large (${(estimatedSize / 1024).toFixed(0)}KB) — using chunked analysis`);
    
    // Group failures by file to keep related failures together
    const failuresByFile = new Map();
    for (const failure of categorized) {
      const key = failure.file || 'unknown';
      if (!failuresByFile.has(key)) failuresByFile.set(key, []);
      failuresByFile.get(key).push(failure);
    }

    // Build chunks targeting ~80k chars each
    const TARGET_CHUNK_SIZE = 80000;
    const chunks = [];
    let currentChunk = { failures: [], sourceCode: {} };
    let currentSize = 0;

    for (const [file, failures] of failuresByFile) {
      const fileSource = sourceCode[`test:${file}`] || '';
      const entrySize = JSON.stringify(failures).length + fileSource.length;

      // If this single file is too large, truncate its source
      const truncatedSource = fileSource.length > 20000 ? fileSource.slice(0, 20000) + '\n// ... [truncated]' : fileSource;

      if (currentSize + entrySize > TARGET_CHUNK_SIZE && currentChunk.failures.length > 0) {
        chunks.push(currentChunk);
        currentChunk = { failures: [], sourceCode: {} };
        currentSize = 0;
      }

      currentChunk.failures.push(...failures);
      if (truncatedSource) currentChunk.sourceCode[`test:${file}`] = truncatedSource;
      currentSize += entrySize;
    }
    if (currentChunk.failures.length > 0) chunks.push(currentChunk);

    // Include app source code only in the first chunk (context)
    const appSourceKeys = Object.keys(sourceCode).filter(k => k.startsWith('app:'));
    for (const key of appSourceKeys) {
      if (chunks.length > 0) {
        // Truncate large app files
        const content = sourceCode[key];
        chunks[0].sourceCode[key] = content.length > 15000 ? content.slice(0, 15000) + '\n// ... [truncated]' : content;
      }
    }

    logger.info(`Split ${categorized.length} failures into ${chunks.length} chunk(s)`);

    // Process each chunk and merge results
    const allAnalysisResults = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      logger.info(`Analyzing chunk ${i + 1}/${chunks.length} (${chunk.failures.length} failures)...`);
      
      try {
        const chunkAnalysis = await this.aiProvider.analyzeFailures(
          { failures: chunk.failures, passCount: testResults.passed, failCount: testResults.failed, chunkInfo: `${i + 1}/${chunks.length}` },
          chunk.sourceCode
        );
        allAnalysisResults.push(chunkAnalysis);
      } catch (err) {
        logger.warn(`Chunk ${i + 1} analysis failed: ${err.message}`);
      }
    }

    // Merge all chunk results into a single analysis
    const mergedAnalysis = this._mergeChunkedAnalysis(allAnalysisResults);

    return {
      failures: categorized,
      analysis: mergedAnalysis,
      sourceCode
    };
  }

  /**
   * Merge analysis results from multiple chunks into a single unified result.
   */
  _mergeChunkedAnalysis(results) {
    if (results.length === 0) return { fixes: [], summary: 'No analysis results' };
    if (results.length === 1) return results[0];

    const merged = {
      fixes: [],
      rootCauses: [],
      summary: ''
    };

    for (const result of results) {
      if (Array.isArray(result)) {
        // If AI returned an array directly (array of fixes)
        merged.fixes.push(...result);
      } else if (result && typeof result === 'object') {
        if (result.fixes) merged.fixes.push(...result.fixes);
        if (result.rootCauses) merged.rootCauses.push(...result.rootCauses);
        if (result.summary) merged.summary += (merged.summary ? '\n' : '') + result.summary;
      }
    }

    // Deduplicate fixes by file+originalCode
    const seenFixes = new Set();
    merged.fixes = merged.fixes.filter(fix => {
      if (!fix || !fix.file) return false;
      const key = `${fix.file}::${(fix.originalCode || '').slice(0, 100)}`;
      if (seenFixes.has(key)) return false;
      seenFixes.add(key);
      return true;
    });

    return merged;
  }

  /**
   * Generate and validate fixes for identified issues.
   * Implements guardrails: quick-check per fix + full regression check.
   */
  async generateAndApplyFixes(failureAnalysis, workDir, config = {}) {
    logger.info('Generating fixes...');

    // Check if the analysis already contains actionable fixes (from chunked analysis)
    let fixes = this._extractFixesFromAnalysis(failureAnalysis.analysis);
    
    if (fixes.length > 0) {
      logger.info(`Found ${fixes.length} fix(es) directly from failure analysis`);
    } else {
      // Build a focused source code map: only include files mentioned in the analysis
      const focusedSourceCode = {};
      const analysisFiles = new Set();
      
      // Extract file references from the analysis
      if (failureAnalysis.analysis) {
        const analysisStr = JSON.stringify(failureAnalysis.analysis);
        const fileRefs = analysisStr.match(/(?:tests?\/[^\s"',]+\.(?:spec|test)\.[jt]sx?|generated-tests\/[^\s"',]+\.[jt]sx?)/g);
        if (fileRefs) fileRefs.forEach(f => analysisFiles.add(f.replace(/['"]/g, '')));
        
        if (failureAnalysis.analysis.failures) {
          for (const f of failureAnalysis.analysis.failures) {
            if (f.file) analysisFiles.add(f.file);
          }
        }
      }
      
      if (failureAnalysis.failures) {
        for (const f of failureAnalysis.failures) {
          if (f.file) analysisFiles.add(f.file);
        }
      }

      // Only include source code for files referenced in failures (cap at 15 files)
      const relevantFiles = [...analysisFiles].slice(0, 15);
      for (const file of relevantFiles) {
        const sourceKey = `test:${file}`;
        if (failureAnalysis.sourceCode[sourceKey]) {
          const content = failureAnalysis.sourceCode[sourceKey];
          focusedSourceCode[sourceKey] = content.length > 10000 
            ? content.slice(0, 10000) + '\n// ... [truncated]' 
            : content;
        }
      }

      // Include a few app source files for context
      const appKeys = Object.keys(failureAnalysis.sourceCode).filter(k => k.startsWith('app:')).slice(0, 5);
      for (const key of appKeys) {
        const content = failureAnalysis.sourceCode[key];
        focusedSourceCode[key] = content.length > 8000 
          ? content.slice(0, 8000) + '\n// ... [truncated]' 
          : content;
      }

      logger.info(`Sending ${Object.keys(focusedSourceCode).length} source file(s) to fix generator`);

      // If too many failures, chunk the fix generation too
      const analysisFailures = failureAnalysis.analysis?.failures || failureAnalysis.failures || [];
      if (analysisFailures.length > 15) {
        logger.info(`Large failure set (${analysisFailures.length}) — generating fixes in batches`);
        fixes = await this._generateFixesInChunks(failureAnalysis.analysis, focusedSourceCode, analysisFailures);
      } else {
        let rawFixes = await this.aiProvider.generateFix(
          failureAnalysis.analysis,
          focusedSourceCode
        );
        fixes = this._unwrapFixes(rawFixes);
      }
    }

    if (!Array.isArray(fixes) || fixes.length === 0) {
      logger.warn('AI returned no fixes');
      return { applied: [], reverted: [], noFixes: true };
    }

    logger.info(`AI proposed ${fixes.length} fix(es)`);

    const applied = [];
    const reverted = [];
    const backups = new Map();

    for (const fix of fixes) {
      if (!fix.file || !fix.originalCode || !fix.fixedCode) {
        logger.warn(`Skipping invalid fix: ${JSON.stringify(fix).slice(0, 100)}`);
        continue;
      }

      const result = await this._applyAndValidateFix(fix, workDir, backups, config);

      if (result.success) {
        applied.push({ ...fix, validated: true });
        logger.info(`Fix applied and validated: ${fix.file} — ${fix.explanation || 'no explanation'}`);
      } else {
        reverted.push({ ...fix, reason: result.reason });
        logger.warn(`Fix reverted: ${fix.file} — ${result.reason}`);
      }
    }

    logger.info(`Fixes: ${applied.length} applied, ${reverted.length} reverted`);
    return { applied, reverted };
  }

  /**
   * Apply a single fix and validate it doesn't break anything.
   * Reverts if validation fails.
   */
  async _applyAndValidateFix(fix, workDir, backups, config) {
    const filePath = this._resolveFixPath(fix.file, workDir);

    if (!fs.existsSync(filePath)) {
      return { success: false, reason: `File not found: ${fix.file}` };
    }

    // Backup the original file
    const originalContent = fs.readFileSync(filePath, 'utf-8');
    backups.set(filePath, originalContent);

    // Apply the fix — exact string replacement
    if (!originalContent.includes(fix.originalCode)) {
      return { success: false, reason: 'Original code not found in file (exact match failed)' };
    }

    const fixedContent = originalContent.replace(fix.originalCode, fix.fixedCode);
    fs.writeFileSync(filePath, fixedContent, 'utf-8');

    // Quick validation: run only the failing test(s) if we can identify them
    if (config.appUrl) {
      try {
        // Run a quick check
        const result = await TestRunner.runTests(workDir, { appUrl: config.appUrl });

        if (result.failed > 0) {
          // Check if we introduced new failures
          const prevFailed = config.previousFailCount || 0;
          if (result.failed > prevFailed) {
            // Revert — this fix made things worse
            fs.writeFileSync(filePath, originalContent, 'utf-8');
            return { success: false, reason: 'Fix introduced new failures' };
          }
        }
      } catch (err) {
        logger.warn(`Validation run failed: ${err.message} — keeping fix tentatively`);
      }
    }

    return { success: true };
  }

  /**
   * Full regression check after all fixes in a batch are applied.
   */
  async validateAllFixes(workDir, previousPassCount, config = {}) {
    logger.info('Running full regression check...');

    const result = await TestRunner.runTests(workDir, config);

    if (result.passed >= previousPassCount) {
      logger.info(`Regression check passed: ${result.passed} passed (was ${previousPassCount})`);
      return { passed: true, result };
    }

    logger.warn(`Regression detected: ${result.passed} passed (was ${previousPassCount})`);
    return { passed: false, result };
  }

  /**
   * Revert all fixes from a batch using backups.
   */
  revertBatch(backups) {
    let reverted = 0;
    for (const [filePath, content] of backups) {
      fs.writeFileSync(filePath, content, 'utf-8');
      reverted++;
    }
    logger.info(`Reverted ${reverted} file(s) to pre-fix state`);
    return reverted;
  }

  /**
   * Extract actionable fixes from analysis results (when analysis already contains originalCode/fixedCode).
   */
  _extractFixesFromAnalysis(analysis) {
    const fixes = [];
    if (!analysis) return fixes;

    // Check if the analysis has a fixes array with complete fix objects
    const candidates = analysis.fixes || analysis.failures || [];
    for (const item of candidates) {
      if (item && item.file && item.originalCode && item.fixedCode) {
        fixes.push({
          file: item.file,
          originalCode: item.originalCode,
          fixedCode: item.fixedCode,
          explanation: item.explanation || item.suggestedFix || item.rootCause || 'AI-suggested fix'
        });
      }
    }

    return fixes;
  }

  /**
   * Unwrap fix response from AI — handles both array and wrapped object formats.
   */
  _unwrapFixes(rawFixes) {
    if (Array.isArray(rawFixes)) return rawFixes;
    if (!rawFixes || typeof rawFixes !== 'object') return [];

    // Try common wrapper keys
    if (Array.isArray(rawFixes.fixes)) return rawFixes.fixes;
    if (Array.isArray(rawFixes.changes)) return rawFixes.changes;
    if (Array.isArray(rawFixes.patches)) return rawFixes.patches;

    // Try to find any array property
    const arrayProp = Object.values(rawFixes).find(v => Array.isArray(v));
    return arrayProp || [];
  }

  /**
   * Generate fixes in chunks when there are too many failures for a single AI call.
   */
  async _generateFixesInChunks(analysis, sourceCode, failures) {
    const BATCH_SIZE = 10;
    const allFixes = [];
    
    for (let i = 0; i < failures.length; i += BATCH_SIZE) {
      const batch = failures.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(failures.length / BATCH_SIZE);
      
      logger.info(`Generating fixes batch ${batchNum}/${totalBatches} (${batch.length} failures)...`);

      // Build focused source code for this batch
      const batchSourceCode = {};
      for (const failure of batch) {
        const file = failure.file;
        if (file && sourceCode[`test:${file}`]) {
          batchSourceCode[`test:${file}`] = sourceCode[`test:${file}`];
        }
      }

      // Include app source in first batch only
      if (i === 0) {
        const appKeys = Object.keys(sourceCode).filter(k => k.startsWith('app:'));
        for (const key of appKeys) {
          batchSourceCode[key] = sourceCode[key];
        }
      }

      try {
        const batchAnalysis = {
          ...analysis,
          failures: batch,
          batchInfo: `${batchNum}/${totalBatches}`
        };

        const rawFixes = await this.aiProvider.generateFix(batchAnalysis, batchSourceCode);
        const fixes = this._unwrapFixes(rawFixes);
        allFixes.push(...fixes);
        logger.info(`  Batch ${batchNum}: ${fixes.length} fix(es)`);
      } catch (err) {
        logger.warn(`  Batch ${batchNum} failed: ${err.message}`);
      }
    }

    // Deduplicate by file+originalCode
    const seen = new Set();
    return allFixes.filter(fix => {
      if (!fix || !fix.file) return false;
      const key = `${fix.file}::${(fix.originalCode || '').slice(0, 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Resolve fix path — handles both app code and test code references.
   */
  _resolveFixPath(file, workDir) {
    // If path starts with generated-tests/, it's a test file
    if (file.startsWith('generated-tests/')) {
      return path.join(workDir, file);
    }

    // Check if it exists directly in workDir
    const direct = path.join(workDir, file);
    if (fs.existsSync(direct)) return direct;

    // Check in generated-tests (exact match)
    const inTests = path.join(workDir, 'generated-tests', file);
    if (fs.existsSync(inTests)) return inTests;

    // Check in generated-tests/tests/ (AI often returns e2e/foo.spec.js without tests/ prefix)
    const inTestsSubdir = path.join(workDir, 'generated-tests', 'tests', file);
    if (fs.existsSync(inTestsSubdir)) return inTestsSubdir;

    // Try to find by filename in generated-tests/ (last resort)
    const basename = path.basename(file);
    const genTestDir = path.join(workDir, 'generated-tests');
    if (fs.existsSync(genTestDir)) {
      const findInDir = (dir) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === basename) return fullPath;
            if (entry.isDirectory() && entry.name !== 'node_modules') {
              const found = findInDir(fullPath);
              if (found) return found;
            }
          }
        } catch { /* ignore */ }
        return null;
      };
      const found = findInDir(genTestDir);
      if (found) return found;
    }

    return direct;
  }

  /**
   * Get list of files modified by fixes (for committing).
   */
  getModifiedFiles(appliedFixes) {
    const files = new Set();
    for (const fix of appliedFixes) {
      files.add(fix.file);
    }
    return Array.from(files);
  }
}

module.exports = IssueFixer;
