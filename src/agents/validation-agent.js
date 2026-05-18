'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const logger = require('../utils/logger');
const BaseSubAgent = require('./base-sub-agent');

/**
 * Validation & Fixes Agent — Responsible for:
 * - Syntax validation of generated test files
 * - Automation framework analysis and required package installation
 * - Playwright config validation
 * - Unit test file validation (Node.js require check)
 * - AI-powered fix generation for broken tests
 * - Iterative fix-validate loop until all tests are syntactically valid
 *
 * Iterates internally until all generated tests pass validation or max iterations reached.
 */
class ValidationAgent extends BaseSubAgent {
  constructor(config, dependencies) {
    super('validation', config, dependencies);
    this.aiProvider = dependencies.codeGenProvider || dependencies.aiProvider;
    this.issueFixer = dependencies.issueFixer;
    this.testGenerator = dependencies.testGenerator;
    this.dependencyInstaller = dependencies.dependencyInstaller;
  }

  /**
   * Run a single iteration of the validation agent.
   * Each iteration: validate → identify broken files → fix → re-validate.
   */
  async _runIteration(context, iteration, previousResult = null) {
    const { workDir, techStack, generated, codeAnalysis } = context;
    const generatedTestDir = path.join(workDir, 'generated-tests');

    if (!fs.existsSync(generatedTestDir)) {
      logger.info('[validation] No generated-tests directory found — nothing to validate');
      return { status: 'success', complete: true, coverage: 100, validFiles: 0, brokenFiles: 0, fixed: 0 };
    }

    const artifacts = [];
    const issues = [];

    // ── Phase 1: Framework & Dependency Validation ──────────────
    if (iteration === 0) {
      logger.info('[validation] Phase 1: Framework & Dependency Validation');
      await this._validateAndInstallDependencies(workDir, generatedTestDir, techStack);
    }

    // ── Phase 2: Syntax Validation ──────────────────────────────
    logger.info(`[validation] Phase 2: Syntax Validation (iteration ${iteration + 1})`);
    const allTestFiles = this._collectTestFiles(generatedTestDir);
    const validationResult = this._validateAllFiles(generatedTestDir, allTestFiles);

    logger.info(`[validation] Files: ${allTestFiles.length} total | ${validationResult.valid.length} valid | ${validationResult.broken.length} broken`);

    if (validationResult.broken.length === 0) {
      logger.info('[validation] ✅ All test files pass syntax validation');
      // Also do Playwright list check
      const listResult = await this._playwrightListCheck(generatedTestDir);
      return {
        status: 'success',
        complete: true,
        coverage: 100,
        validFiles: validationResult.valid.length,
        brokenFiles: 0,
        fixed: previousResult?.fixed || 0,
        playwrightListResult: listResult,
        artifacts,
        issues
      };
    }

    // ── Phase 3: Auto-Fix Broken Files ──────────────────────────
    logger.info(`[validation] Phase 3: Fixing ${validationResult.broken.length} broken file(s)`);
    let fixedCount = 0;
    let removedCount = 0;

    for (const { relPath, fullPath, content, error } of validationResult.broken) {
      logger.debug(`[validation]   Fixing: ${relPath} — ${error}`);

      // Attempt auto-fix pipeline
      const fixed = await this._attemptFix(fullPath, relPath, content, error, codeAnalysis, workDir);

      if (fixed) {
        fixedCount++;
      } else {
        // If unfixable, remove to prevent blocking other tests
        logger.warn(`[validation]   🗑️ Removing unfixable: ${relPath}`);
        try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
        removedCount++;
        issues.push({ file: relPath, error, action: 'removed' });
      }
    }

    logger.info(`[validation] Fixed: ${fixedCount} | Removed: ${removedCount}`);

    // ── Phase 4: Playwright List Check ──────────────────────────
    const listResult = await this._playwrightListCheck(generatedTestDir);

    // Calculate validation coverage (% of files that are valid)
    const totalOriginalFiles = allTestFiles.length;
    const nowValid = totalOriginalFiles - validationResult.broken.length + fixedCount;
    const validationCoverage = totalOriginalFiles > 0 ? Math.round((nowValid / totalOriginalFiles) * 100) : 100;

    return {
      status: fixedCount > 0 || removedCount > 0 ? 'improved' : 'no-change',
      complete: validationResult.broken.length === fixedCount + removedCount,
      coverage: validationCoverage,
      validFiles: nowValid,
      brokenFiles: validationResult.broken.length - fixedCount - removedCount,
      fixed: (previousResult?.fixed || 0) + fixedCount,
      removed: removedCount,
      playwrightListResult: listResult,
      artifacts,
      issues
    };
  }

  /**
   * Validate and install required test framework dependencies.
   */
  async _validateAndInstallDependencies(workDir, generatedTestDir, techStack) {
    const DependencyInstaller = this.dependencyInstaller || require('../core/dependency-installer');

    // Check if playwright is available
    const playwrightConfigPath = path.join(generatedTestDir, 'playwright.config.js');
    if (fs.existsSync(playwrightConfigPath)) {
      try {
        const { execSync } = require('child_process');
        execSync('npx playwright --version', { cwd: workDir, timeout: 15000, stdio: 'pipe' });
        logger.info('[validation] ✅ Playwright available');
      } catch {
        logger.info('[validation] Installing Playwright...');
        try {
          const { execSync } = require('child_process');
          execSync('npx playwright install chromium --with-deps', { cwd: workDir, timeout: 120000, stdio: 'pipe' });
          logger.info('[validation] ✅ Playwright installed');
        } catch (err) {
          logger.warn(`[validation] Playwright installation failed: ${err.message}`);
        }
      }
    }

    // Check if Jest is available for unit tests
    const jestConfigPath = path.join(generatedTestDir, 'jest.config.js');
    if (fs.existsSync(jestConfigPath)) {
      const pkgJsonPath = path.join(workDir, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (!allDeps.jest) {
            logger.info('[validation] Installing Jest...');
            const { execSync } = require('child_process');
            execSync('npm install --save-dev jest', { cwd: workDir, timeout: 60000, stdio: 'pipe' });
            logger.info('[validation] ✅ Jest installed');
          } else {
            logger.info('[validation] ✅ Jest available');
          }
        } catch (err) {
          logger.warn(`[validation] Jest check/install failed: ${err.message}`);
        }
      }
    }
  }

  /**
   * Collect all test files from generated-tests directory.
   */
  _collectTestFiles(baseDir, relativeTo = baseDir) {
    const files = [];
    this._walkDir(baseDir, relativeTo, files);
    return files;
  }

  _walkDir(dir, relativeTo, files, depth = 0) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._walkDir(fullPath, relativeTo, files, depth + 1);
      } else if (/\.(spec|test)\.(js|ts|mjs)$/.test(entry.name)) {
        files.push(path.relative(relativeTo, fullPath));
      }
    }
  }

  /**
   * Validate all test files for syntax errors.
   */
  _validateAllFiles(baseDir, files) {
    const valid = [];
    const broken = [];

    for (const relPath of files) {
      const fullPath = path.join(baseDir, relPath);
      if (!fs.existsSync(fullPath)) continue;

      // Skip TypeScript files for vm.Script validation (needs transpilation)
      if (relPath.endsWith('.ts')) {
        valid.push(relPath);
        continue;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const error = this._checkSyntax(content, relPath);
      if (error) {
        broken.push({ relPath, fullPath, content, error });
      } else {
        valid.push(relPath);
      }
    }

    return { valid, broken };
  }

  /**
   * Check JavaScript syntax using vm.Script.
   */
  _checkSyntax(code, filename) {
    try {
      new vm.Script(code, { filename, displayErrors: false });
      return null;
    } catch (err) {
      const match = err.message.match(/^(.*?)(\n|$)/);
      return match ? match[1] : err.message;
    }
  }

  /**
   * Attempt to fix a broken test file using multiple strategies.
   */
  async _attemptFix(fullPath, relPath, content, error, codeAnalysis, workDir) {
    // Strategy 1: Common pattern fixes (no AI needed)
    const basicFix = this._applyBasicFixes(content, error);
    if (basicFix) {
      const recheckError = this._checkSyntax(basicFix, relPath);
      if (!recheckError) {
        fs.writeFileSync(fullPath, basicFix, 'utf-8');
        logger.debug(`[validation]   ✅ Fixed via basic patterns: ${relPath}`);
        return true;
      }
    }

    // Strategy 2: AI-powered fix
    if (this.aiProvider) {
      try {
        const fixResult = await this.aiProvider.generateFix(
          {
            summary: `Syntax error in generated test file`,
            rootCause: `${relPath}: ${error}`,
            fixes: [{ file: relPath, description: `Fix syntax: ${error}`, type: 'syntax' }]
          },
          { [relPath]: content }
        );

        if (fixResult && fixResult.fixes && fixResult.fixes.length > 0) {
          let fixed = content;
          for (const fix of fixResult.fixes) {
            if (fix.fixedCode && fix.originalCode) {
              const result = fixed.replace(fix.originalCode, fix.fixedCode);
              if (result !== fixed) { fixed = result; break; }
            } else if (fix.fixedCode && !fix.originalCode) {
              fixed = fix.fixedCode;
              break;
            }
          }

          if (fixed !== content) {
            const recheckError = this._checkSyntax(fixed, relPath);
            if (!recheckError) {
              fs.writeFileSync(fullPath, fixed, 'utf-8');
              logger.debug(`[validation]   ✅ Fixed via AI: ${relPath}`);
              return true;
            }
          }
        }
      } catch (err) {
        logger.debug(`[validation]   AI fix failed for ${relPath}: ${err.message}`);
      }
    }

    return false;
  }

  /**
   * Apply common automatic syntax fixes.
   */
  _applyBasicFixes(code, error) {
    let fixed = code;

    // Fix ESM imports → CommonJS
    fixed = fixed.replace(/^import\s+(.+?)\s+from\s+['"](.+?)['"]\s*;?\s*$/gm, (match, imports, module) => {
      const defaultImport = imports.match(/^(\w+)$/);
      const namedImport = imports.match(/\{\s*(.+?)\s*\}/);
      if (defaultImport) {
        return `const ${defaultImport[1]} = require('${module}');`;
      } else if (namedImport) {
        return `const { ${namedImport[1]} } = require('${module}');`;
      }
      return `const ${imports} = require('${module}');`;
    });

    // Fix unbalanced parentheses on statement lines
    const lines = fixed.split('\n');
    let modified = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();
      if (!trimmed.endsWith(';')) continue;
      let openParens = 0;
      let inStr = false, strChar = '';
      for (let j = 0; j < trimmed.length; j++) {
        const ch = trimmed[j];
        if (inStr) { if (ch === strChar && trimmed[j - 1] !== '\\') inStr = false; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strChar = ch; continue; }
        if (ch === '(') openParens++;
        else if (ch === ')') openParens--;
      }
      if (openParens > 0) {
        lines[i] = trimmed.replace(/;$/, ')'.repeat(openParens) + ';');
        modified = true;
      }
    }
    if (modified) fixed = lines.join('\n');

    return fixed !== code ? fixed : null;
  }

  /**
   * Run Playwright --list to validate test discovery.
   */
  async _playwrightListCheck(generatedTestDir) {
    const configPath = path.join(generatedTestDir, 'playwright.config.js');
    if (!fs.existsSync(configPath)) return { available: false };

    try {
      const { execSync } = require('child_process');
      const output = execSync('npx playwright test --list 2>&1', {
        cwd: generatedTestDir,
        timeout: 60000,
        encoding: 'utf-8',
        env: { ...process.env, CI: 'true', APP_URL: process.env.APP_URL || 'http://localhost:3000' }
      });
      const testCount = (output.match(/(\d+) test/)?.[1]) || '0';
      logger.info(`[validation] Playwright list check: ${testCount} test(s) discovered`);
      return { available: true, testCount: parseInt(testCount, 10), output };
    } catch (err) {
      const stderr = err.stderr || err.stdout || err.message || '';
      logger.warn(`[validation] Playwright list check failed: ${stderr.slice(0, 200)}`);
      return { available: true, error: stderr.slice(0, 500) };
    }
  }

  /**
   * Override: validation is "complete" when all files are valid.
   */
  _isComplete(result) {
    return result && result.complete === true;
  }
}

module.exports = ValidationAgent;
