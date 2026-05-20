'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const INSTALL_TIMEOUT = 5 * 60 * 1000; // 5 minutes

class DependencyInstaller {
  /**
   * Detect which package manager the project uses.
   * Checks root first, then common subdirectories.
   * Returns { manager, installDir } where installDir is the directory containing the lock/package file.
   */
  static detectPackageManager(workDir) {
    const checks = [
      { file: 'package-lock.json', manager: 'npm' },
      { file: 'yarn.lock', manager: 'yarn' },
      { file: 'pnpm-lock.yaml', manager: 'pnpm' },
      { file: 'requirements.txt', manager: 'pip' },
      { file: 'Pipfile', manager: 'pipenv' }
    ];

    // Check root directory first
    for (const check of checks) {
      if (fs.existsSync(path.join(workDir, check.file))) {
        logger.info(`Detected package manager: ${check.manager} (found ${check.file})`);
        return { manager: check.manager, installDir: workDir };
      }
    }

    // Fallback: if package.json exists at root, use npm
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
      logger.info('Detected package manager: npm (fallback — package.json found)');
      return { manager: 'npm', installDir: workDir };
    }

    // Search one level deep for monorepo/subdirectory projects
    try {
      const entries = fs.readdirSync(workDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (['node_modules', '.git', 'generated-tests', 'logs', 'test-results'].includes(entry.name)) continue;
        
        const subDir = path.join(workDir, entry.name);
        for (const check of checks) {
          if (fs.existsSync(path.join(subDir, check.file))) {
            logger.info(`Detected package manager: ${check.manager} (found ${entry.name}/${check.file})`);
            return { manager: check.manager, installDir: subDir };
          }
        }
        if (fs.existsSync(path.join(subDir, 'package.json'))) {
          logger.info(`Detected package manager: npm (found ${entry.name}/package.json)`);
          return { manager: 'npm', installDir: subDir };
        }
      }
    } catch (err) {
      logger.debug(`Error searching subdirectories: ${err.message}`);
    }

    logger.warn('No recognized package manager detected');
    return { manager: null, installDir: workDir };
  }

  /**
   * Install project dependencies using the detected package manager.
   */
  static async installDependencies(workDir, packageManager) {
    if (!packageManager) {
      logger.warn('No package manager specified, skipping dependency installation');
      return { success: true, skipped: true };
    }

    const commands = {
      npm: fs.existsSync(path.join(workDir, 'package-lock.json'))
        ? 'npm ci --include=dev'
        : 'npm install --include=dev',
      yarn: 'yarn install --frozen-lockfile',
      pnpm: 'pnpm install --frozen-lockfile',
      pip: 'pip install -r requirements.txt',
      pipenv: 'pipenv install'
    };

    const cmd = commands[packageManager];
    if (!cmd) {
      throw new Error(`Unsupported package manager: ${packageManager}`);
    }

    logger.info(`Installing dependencies: ${cmd} (in ${workDir})`);

    // Override NODE_ENV to ensure devDependencies are installed (needed for test frameworks).
    // In Docker containers NODE_ENV=production is set, which would skip devDeps.
    const installEnv = { ...process.env, NODE_ENV: 'development' };

    const runInstall = (installCmd) => {
      return new Promise((resolve, reject) => {
        const [command, ...args] = installCmd.split(' ');
        const proc = spawn(command, args, {
          cwd: workDir,
          shell: true,
          stdio: 'pipe',
          timeout: INSTALL_TIMEOUT,
          env: installEnv
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          resolve({ code, stdout, stderr });
        });

        proc.on('error', (err) => {
          reject(err);
        });
      });
    };

    // Try the primary command first
    let result = await runInstall(cmd);
    
    // If npm ci fails (stale lock file, integrity mismatch), fall back to npm install
    if (result.code !== 0 && packageManager === 'npm' && cmd.includes('npm ci')) {
      const ciError = result.stderr.slice(-300);
      logger.warn(`npm ci failed: ${ciError}`);
      logger.info('Falling back to npm install --include=dev...');
      result = await runInstall('npm install --include=dev');
    }

    if (result.code === 0) {
      logger.info('Dependencies installed successfully');
      return { success: true, stdout: result.stdout, stderr: result.stderr };
    } else {
      const error = new Error(`Dependency installation failed (exit code ${result.code}): ${result.stderr.slice(-500)}`);
      logger.error(error.message);
      throw error;
    }
  }

  /**
   * Check if Playwright browsers are already installed.
   */
  static isPlaywrightInstalled() {
    try {
      // Check if PLAYWRIGHT_BROWSERS_PATH exists (set in Docker)
      const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
      if (browsersPath && fs.existsSync(browsersPath)) {
        logger.info(`Playwright browsers already installed at: ${browsersPath}`);
        return true;
      }

      // Check if running in Docker (common Docker environment indicators)
      if (process.env.DOCKER_CONTAINER || fs.existsSync('/.dockerenv')) {
        logger.info('Running in Docker container - assuming Playwright pre-installed');
        return true;
      }

      // Check if chromium browser exists in common locations
      const commonPaths = [
        '/ms-playwright/chromium-*/chrome-linux/chrome',
        path.join(process.env.HOME || '/root', '.cache/ms-playwright/chromium-*/chrome-linux/chrome')
      ];

      for (const pathPattern of commonPaths) {
        try {
          // Simple glob-like check
          const dir = path.dirname(pathPattern);
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir, { recursive: true });
            if (files.some(f => f.includes('chrome'))) {
              logger.info('Playwright browsers found in system');
              return true;
            }
          }
        } catch {
          // Ignore errors checking paths
        }
      }

      return false;
    } catch (err) {
      logger.debug(`Error checking Playwright installation: ${err.message}`);
      return false;
    }
  }

  /**
   * Install Playwright browsers (chromium by default).
   * Skips installation if browsers are already available (e.g., in Docker containers).
   */
  static async installPlaywrightBrowsers(workDir) {
    // Skip if already installed (common in Docker containers)
    if (this.isPlaywrightInstalled()) {
      logger.info('✅ Playwright browsers already available - skipping installation');
      return { success: true, skipped: true };
    }

    logger.info('Installing Playwright browsers...');

    // In containers, don't use --with-deps as system packages should already be installed
    const isContainer = process.env.DOCKER_CONTAINER || fs.existsSync('/.dockerenv');
    const args = isContainer 
      ? ['playwright', 'install', 'chromium']  // Skip system deps in container
      : ['playwright', 'install', '--with-deps', 'chromium'];

    return new Promise((resolve, reject) => {
      const proc = spawn('npx', args, {
        cwd: workDir,
        shell: true,
        stdio: 'pipe',
        timeout: INSTALL_TIMEOUT
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          logger.info('Playwright browsers installed successfully');
          resolve({ success: true });
        } else {
          logger.error(`Playwright browser install failed: ${stderr.slice(-500)}`);
          reject(new Error(`Playwright install failed (exit code ${code})`));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Verify that dependencies were installed correctly.
   */
  static verifyInstallation(workDir) {
    const checks = [];

    // Check for node_modules if it's a Node.js project
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
      const nodeModules = path.join(workDir, 'node_modules');
      if (fs.existsSync(nodeModules)) {
        checks.push({ name: 'node_modules', exists: true });
      } else {
        checks.push({ name: 'node_modules', exists: false });
      }
    }

    // Check for Python venv
    if (fs.existsSync(path.join(workDir, 'requirements.txt'))) {
      checks.push({ name: 'python-deps', exists: true }); // pip installs globally
    }

    const allGood = checks.every(c => c.exists);
    if (!allGood) {
      const missing = checks.filter(c => !c.exists).map(c => c.name);
      logger.warn(`Verification issues: missing ${missing.join(', ')}`);
    } else {
      logger.info('Dependency verification passed');
    }

    return { verified: allGood, checks };
  }
}

module.exports = DependencyInstaller;
