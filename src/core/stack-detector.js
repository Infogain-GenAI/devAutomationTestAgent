'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class StackDetector {
  /**
   * Auto-detect the technology stack from the repository.
   */
  static detect(workDir, overrides = {}) {
    logger.info('Detecting technology stack...');

    const result = {
      frontend: null,
      backend: null,
      database: null,
      language: null,
      monorepo: false,
      packageManager: null,
      ...overrides
    };

    // Detect package manager
    if (!result.packageManager) {
      result.packageManager = StackDetector._detectPackageManager(workDir);
    }

    // Detect from package.json
    const pkgPath = path.join(workDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (!result.frontend) {
        result.frontend = StackDetector._detectFrontend(allDeps, pkg, workDir);
      }
      if (!result.backend) {
        result.backend = StackDetector._detectBackend(allDeps, pkg, workDir);
      }
      if (!result.language) {
        result.language = StackDetector._detectLanguage(allDeps, workDir);
      }
    }

    // Detect Python frameworks
    const reqPath = path.join(workDir, 'requirements.txt');
    if (fs.existsSync(reqPath) && !result.backend) {
      result.backend = StackDetector._detectPythonBackend(workDir);
      if (!result.language) result.language = 'python';
    }

    // Detect database
    if (!result.database) {
      result.database = StackDetector._detectDatabase(workDir);
    }

    // Detect monorepo
    result.monorepo = StackDetector._isMonorepo(workDir);

    // Apply overrides on top
    Object.assign(result, overrides);

    logger.info(`Stack detected: ${JSON.stringify({
      frontend: result.frontend?.framework,
      backend: result.backend?.framework,
      language: result.language,
      monorepo: result.monorepo
    })}`);

    return result;
  }

  static _detectPackageManager(workDir) {
    if (fs.existsSync(path.join(workDir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(workDir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(workDir, 'package-lock.json'))) return 'npm';
    if (fs.existsSync(path.join(workDir, 'package.json'))) return 'npm';
    if (fs.existsSync(path.join(workDir, 'requirements.txt'))) return 'pip';
    return null;
  }

  static _detectFrontend(deps, pkg, workDir) {
    const frameworks = [
      { name: 'next', framework: 'nextjs', startCommand: 'npm run dev', port: 3000 },
      { name: 'nuxt', framework: 'nuxt', startCommand: 'npm run dev', port: 3000 },
      { name: 'react', framework: 'react', startCommand: 'npm start', port: 3000 },
      { name: 'vue', framework: 'vue', startCommand: 'npm run serve', port: 8080 },
      { name: '@angular/core', framework: 'angular', startCommand: 'ng serve', port: 4200 },
      { name: 'svelte', framework: 'svelte', startCommand: 'npm run dev', port: 5173 }
    ];

    for (const fw of frameworks) {
      if (deps[fw.name]) {
        return {
          framework: fw.framework,
          version: deps[fw.name].replace(/[\^~]/, ''),
          startCommand: pkg.scripts?.dev || pkg.scripts?.start || fw.startCommand,
          port: fw.port,
          entryPoint: StackDetector._findEntryPoint(workDir, fw.framework)
        };
      }
    }

    return null;
  }

  static _detectBackend(deps, pkg, workDir) {
    const frameworks = [
      { name: 'express', framework: 'express', port: 3000 },
      { name: 'fastify', framework: 'fastify', port: 3000 },
      { name: '@nestjs/core', framework: 'nestjs', port: 3000 },
      { name: 'koa', framework: 'koa', port: 3000 },
      { name: 'hapi', framework: 'hapi', port: 3000 },
      { name: '@hapi/hapi', framework: 'hapi', port: 3000 }
    ];

    for (const fw of frameworks) {
      if (deps[fw.name]) {
        return {
          framework: fw.framework,
          version: deps[fw.name].replace(/[\^~]/, ''),
          startCommand: pkg.scripts?.start || `node ${StackDetector._findServerEntry(workDir)}`,
          port: fw.port,
          entryPoint: StackDetector._findServerEntry(workDir)
        };
      }
    }

    return null;
  }

  static _detectPythonBackend(workDir) {
    const reqPath = path.join(workDir, 'requirements.txt');
    const content = fs.readFileSync(reqPath, 'utf-8').toLowerCase();

    const frameworks = [
      { match: 'django', framework: 'django', startCommand: 'python manage.py runserver', port: 8000 },
      { match: 'flask', framework: 'flask', startCommand: 'flask run', port: 5000 },
      { match: 'fastapi', framework: 'fastapi', startCommand: 'uvicorn main:app', port: 8000 }
    ];

    for (const fw of frameworks) {
      if (content.includes(fw.match)) {
        return {
          framework: fw.framework,
          startCommand: fw.startCommand,
          port: fw.port
        };
      }
    }

    return null;
  }

  static _detectLanguage(deps, workDir) {
    if (deps.typescript || fs.existsSync(path.join(workDir, 'tsconfig.json'))) {
      return 'typescript';
    }
    return 'javascript';
  }

  static _detectDatabase(workDir) {
    const pkgPath = path.join(workDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps.pg || deps.sequelize || deps.knex || deps.prisma) return { type: 'postgresql' };
    if (deps.mysql2 || deps.mysql) return { type: 'mysql' };
    if (deps.mongoose || deps.mongodb) return { type: 'mongodb' };
    if (deps.redis || deps.ioredis) return { type: 'redis' };
    if (deps['better-sqlite3'] || deps.sqlite3) return { type: 'sqlite' };

    return null;
  }

  static _isMonorepo(workDir) {
    const indicators = [
      'lerna.json',
      'nx.json',
      'turbo.json',
      'pnpm-workspace.yaml'
    ];
    return indicators.some(f => fs.existsSync(path.join(workDir, f)));
  }

  static _findEntryPoint(workDir, framework) {
    const candidates = [
      'src/index.tsx', 'src/index.ts', 'src/index.jsx', 'src/index.js',
      'src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/main.js',
      'src/App.tsx', 'src/App.jsx',
      'pages/index.tsx', 'pages/index.js',
      'app/page.tsx', 'app/page.js'
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(workDir, c))) return c;
    }
    return null;
  }

  static _findServerEntry(workDir) {
    const candidates = [
      'src/index.js', 'src/index.ts', 'src/server.js', 'src/server.ts',
      'src/app.js', 'src/app.ts', 'server.js', 'server.ts',
      'index.js', 'app.js', 'server/index.js'
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(workDir, c))) return c;
    }
    return 'src/index.js';
  }
}

module.exports = StackDetector;
