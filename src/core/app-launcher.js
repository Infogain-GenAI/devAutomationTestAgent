'use strict';

const { spawn, exec } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const MAX_RETRIES = 3;
const READY_TIMEOUT = 60000; // 60s per attempt
const POLL_INTERVAL = 2000;  // 2s

class AppLauncher {
  constructor() {
    this.process = null;
    this.pid = null;
    this.url = null;
    this.port = null;
    this.isDockerCompose = false;
  }

  /**
   * Start the target application with retry and fallback.
   * Returns { started: true, url } or { started: false, reason }.
   */
  async startApp(workDir, techStack, config = {}) {
    // If a URL is already provided, just verify it responds
    if (config.url) {
      logger.info(`Using provided app URL: ${config.url}`);
      const reachable = await this._pollUrl(config.url, 10000);
      if (reachable) {
        this.url = config.url;
        return { started: true, url: config.url, method: 'provided-url' };
      }
      logger.warn(`Provided URL ${config.url} is not reachable`);
    }

    // Auto-start if enabled
    if (!config.autoStart) {
      logger.info('Auto-start disabled, skipping app startup');
      return { started: false, reason: 'auto-start-disabled' };
    }

    const startCommand = this._detectStartCommand(workDir, techStack, config);
    this.port = this._detectPort(workDir, techStack, config);

    if (!startCommand) {
      logger.warn('Could not detect start command');
      return { started: false, reason: 'no-start-command' };
    }

    logger.info(`Starting app: "${startCommand}" on port ${this.port}`);

    // Retry loop
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      logger.info(`Startup attempt ${attempt}/${MAX_RETRIES}`);

      try {
        await this._spawnApp(workDir, startCommand);
        const started = await this._waitForReady(this.port);

        if (started) {
          this.url = `http://localhost:${this.port}`;
          logger.info(`App started successfully: ${this.url}`);
          return { started: true, url: this.url, method: 'auto-started', attempts: attempt };
        }
      } catch (err) {
        logger.warn(`Attempt ${attempt} failed: ${err.message}`);
      }

      // Kill any leftover process before retrying
      await this.killApp();
    }

    logger.error(`App failed to start after ${MAX_RETRIES} attempts`);
    return { started: false, reason: 'all-attempts-failed' };
  }

  /**
   * Detect the start command from the project's config.
   */
  _detectStartCommand(workDir, techStack, config) {
    // 1. Explicit start command
    if (config.startCommand) return config.startCommand;

    // 2. docker-compose
    const composePath = path.join(workDir, 'docker-compose.yml');
    if (fs.existsSync(composePath)) {
      this.isDockerCompose = true;
      return 'docker-compose up -d';
    }

    // 3. package.json scripts
    const pkgPath = path.join(workDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.dev) return 'npm run dev';
      if (pkg.scripts?.start) return 'npm start';
    }

    // 4. Procfile
    const procfile = path.join(workDir, 'Procfile');
    if (fs.existsSync(procfile)) {
      const content = fs.readFileSync(procfile, 'utf-8');
      const webLine = content.split('\n').find(l => l.startsWith('web:'));
      if (webLine) return webLine.replace('web:', '').trim();
    }

    // 5. Tech stack detection fallback
    if (techStack?.backend?.startCommand) return techStack.backend.startCommand;
    if (techStack?.frontend?.startCommand) return techStack.frontend.startCommand;

    return null;
  }

  /**
   * Detect the port the app will listen on.
   */
  _detectPort(workDir, techStack, config) {
    if (config.port) return config.port;

    // Check .env for PORT
    const envPath = path.join(workDir, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const portMatch = content.match(/^PORT\s*=\s*(\d+)/m);
      if (portMatch) return parseInt(portMatch[1], 10);
    }

    if (techStack?.frontend?.port) return techStack.frontend.port;
    if (techStack?.backend?.port) return techStack.backend.port;

    return 3000; // Default
  }

  /**
   * Spawn the app as a child process.
   */
  async _spawnApp(workDir, command) {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');

      this.process = spawn(cmd, args, {
        cwd: workDir,
        shell: true,
        stdio: 'pipe',
        detached: true,
        env: { ...process.env, PORT: String(this.port) }
      });

      this.pid = this.process.pid;

      this.process.stderr.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('EADDRINUSE')) {
          reject(new Error(`Port ${this.port} is already in use`));
        }
      });

      this.process.on('error', (err) => {
        reject(err);
      });

      // Give it a moment to start
      setTimeout(resolve, 3000);
    });
  }

  /**
   * Wait for the app to become ready (poll HTTP or TCP).
   */
  async _waitForReady(port) {
    const startTime = Date.now();

    while (Date.now() - startTime < READY_TIMEOUT) {
      // Try HTTP health check
      const httpReady = await this._pollUrl(`http://localhost:${port}`, 3000).catch(() => false);
      if (httpReady) return true;

      // Try common health endpoints
      for (const endpoint of ['/health', '/api/health', '/healthz']) {
        const ready = await this._pollUrl(`http://localhost:${port}${endpoint}`, 2000).catch(() => false);
        if (ready) return true;
      }

      // Try TCP connection as last resort
      const tcpReady = await this._checkTcp(port).catch(() => false);
      if (tcpReady) {
        // TCP connected but HTTP didn't respond — wait a bit more
        await this._sleep(2000);
        const httpRetry = await this._pollUrl(`http://localhost:${port}`, 3000).catch(() => false);
        if (httpRetry) return true;
      }

      await this._sleep(POLL_INTERVAL);
    }

    return false;
  }

  /**
   * Poll a URL to check if it responds (any status code).
   */
  _pollUrl(url, timeout = 3000) {
    return new Promise((resolve) => {
      const req = http.get(url, { timeout }, (res) => {
        resolve(true);
        res.resume(); // consume response
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Check if a TCP port is accepting connections.
   */
  _checkTcp(port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, 'localhost');
    });
  }

  /**
   * Kill the spawned app process.
   */
  async killApp() {
    if (this.isDockerCompose) {
      logger.info('Stopping docker-compose services');
      return new Promise((resolve) => {
        exec('docker-compose down', { timeout: 30000 }, () => {
          this.process = null;
          this.pid = null;
          resolve();
        });
      });
    }

    if (this.process) {
      logger.info(`Killing app process (PID: ${this.pid})`);
      try {
        // Try graceful shutdown
        this.process.kill('SIGTERM');
        await this._sleep(5000);

        // Force kill if still running
        if (!this.process.killed) {
          this.process.kill('SIGKILL');
        }
      } catch (err) {
        logger.warn(`Error killing process: ${err.message}`);
      }
      this.process = null;
      this.pid = null;
    }
  }

  getUrl() {
    return this.url;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AppLauncher;
