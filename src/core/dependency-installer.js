'use strict';

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const INSTALL_TIMEOUT = 5 * 60 * 1000; // 5 minutes

class DependencyInstaller {
  /**
   * Detect which package manager the project uses.
   */
  static detectPackageManager(workDir) {
    const checks = [
      { file: 'package-lock.json', manager: 'npm' },
      { file: 'yarn.lock', manager: 'yarn' },
      { file: 'pnpm-lock.yaml', manager: 'pnpm' },
      { file: 'requirements.txt', manager: 'pip' },
      { file: 'Pipfile', manager: 'pipenv' }
    ];

    for (const check of checks) {
      if (fs.existsSync(path.join(workDir, check.file))) {
        logger.info(`Detected package manager: ${check.manager} (found ${check.file})`);
        return check.manager;
      }
    }

    // Fallback: if package.json exists, use npm
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
      logger.info('Detected package manager: npm (fallback — package.json found)');
      return 'npm';
    }

    logger.warn('No recognized package manager detected');
    return null;
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
      npm: fs.existsSync(path.join(workDir, 'package-lock.json')) ? 'npm ci' : 'npm install',
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

    return new Promise((resolve, reject) => {
      const [command, ...args] = cmd.split(' ');
      const proc = spawn(command, args, {
        cwd: workDir,
        shell: true,
        stdio: 'pipe',
        timeout: INSTALL_TIMEOUT
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
        if (code === 0) {
          logger.info('Dependencies installed successfully');
          resolve({ success: true, stdout, stderr });
        } else {
          const error = new Error(`Dependency installation failed (exit code ${code}): ${stderr.slice(-500)}`);
          logger.error(error.message);
          reject(error);
        }
      });

      proc.on('error', (err) => {
        logger.error(`Failed to spawn install command: ${err.message}`);
        reject(err);
      });
    });
  }

  /**
   * Install Playwright browsers (chromium by default).
   */
  static async installPlaywrightBrowsers(workDir) {
    logger.info('Installing Playwright browsers...');

    return new Promise((resolve, reject) => {
      const proc = spawn('npx', ['playwright', 'install', '--with-deps', 'chromium'], {
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
