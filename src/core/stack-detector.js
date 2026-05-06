'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class StackDetector {
  /**
   * Auto-detect the technology stack from the repository.
   * Searches root and one-level-deep subdirectories.
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
      projectRoot: workDir,
      ...overrides
    };

    // Detect package manager
    if (!result.packageManager) {
      result.packageManager = StackDetector._detectPackageManager(workDir);
    }

    // Find all package.json files (root + one level deep)
    const packageJsonDirs = StackDetector._findPackageJsonDirs(workDir);

    // Analyze each package.json for tech stack
    for (const dir of packageJsonDirs) {
      const pkgPath = path.join(dir, 'package.json');
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (!result.frontend) {
          result.frontend = StackDetector._detectFrontend(allDeps, pkg, dir);
          if (result.frontend) {
            result.frontend.dir = path.relative(workDir, dir) || '.';
            logger.info(`Frontend detected: ${result.frontend.framework} (in ${result.frontend.dir})`);
          }
        }
        if (!result.backend) {
          result.backend = StackDetector._detectBackend(allDeps, pkg, dir);
          if (result.backend) {
            result.backend.dir = path.relative(workDir, dir) || '.';
            logger.info(`Backend detected: ${result.backend.framework} (in ${result.backend.dir})`);
          }
        }
        if (!result.language) {
          result.language = StackDetector._detectLanguage(allDeps, dir);
        }
        if (!result.database) {
          result.database = StackDetector._detectDatabaseFromDeps(allDeps);
        }
      } catch (err) {
        logger.debug(`Failed to parse ${pkgPath}: ${err.message}`);
      }
    }

    // Detect Python frameworks
    const reqPath = path.join(workDir, 'requirements.txt');
    if (fs.existsSync(reqPath) && !result.backend) {
      result.backend = StackDetector._detectPythonBackend(workDir);
      if (!result.language) result.language = 'python';
    }

    // Detect database from config files if not yet found
    if (!result.database) {
      result.database = StackDetector._detectDatabase(workDir);
    }

    // Detect monorepo
    result.monorepo = StackDetector._isMonorepo(workDir);

    // Apply overrides on top
    Object.assign(result, overrides);

    logger.info(`Stack detected: ${JSON.stringify({
      frontend: result.frontend ? `${result.frontend.framework} (${result.frontend.dir || '.'})` : null,
      backend: result.backend ? `${result.backend.framework} (${result.backend.dir || '.'})` : null,
      language: result.language,
      database: result.database?.type || null,
      monorepo: result.monorepo,
      packageManager: result.packageManager
    })}`);

    return result;
  }

  /**
   * Find all directories containing package.json (root + one level deep).
   */
  static _findPackageJsonDirs(workDir) {
    const dirs = [];
    
    // Check root
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
      dirs.push(workDir);
    }

    // Check one level deep
    try {
      const entries = fs.readdirSync(workDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (['node_modules', '.git', 'generated-tests', 'logs', 'test-results', 'reports', 'dist', 'build', '.next'].includes(entry.name)) continue;
        
        const subDir = path.join(workDir, entry.name);
        if (fs.existsSync(path.join(subDir, 'package.json'))) {
          dirs.push(subDir);
        }
      }
    } catch (err) {
      logger.debug(`Error scanning subdirectories: ${err.message}`);
    }

    return dirs;
  }

  static _detectPackageManager(workDir) {
    // Check root
    if (fs.existsSync(path.join(workDir, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(workDir, 'yarn.lock'))) return 'yarn';
    if (fs.existsSync(path.join(workDir, 'package-lock.json'))) return 'npm';
    if (fs.existsSync(path.join(workDir, 'package.json'))) return 'npm';
    if (fs.existsSync(path.join(workDir, 'requirements.txt'))) return 'pip';
    
    // Check one level deep
    try {
      const entries = fs.readdirSync(workDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (['node_modules', '.git', 'generated-tests'].includes(entry.name)) continue;
        const subDir = path.join(workDir, entry.name);
        if (fs.existsSync(path.join(subDir, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(subDir, 'yarn.lock'))) return 'yarn';
        if (fs.existsSync(path.join(subDir, 'package-lock.json'))) return 'npm';
        if (fs.existsSync(path.join(subDir, 'package.json'))) return 'npm';
      }
    } catch {}
    
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

  static _detectDatabaseFromDeps(deps) {
    if (deps.pg || deps.sequelize || deps.knex || deps.prisma || deps['@prisma/client']) return { type: 'postgresql' };
    if (deps.mysql2 || deps.mysql) return { type: 'mysql' };
    if (deps.mongoose || deps.mongodb) return { type: 'mongodb' };
    if (deps.redis || deps.ioredis) return { type: 'redis' };
    if (deps['better-sqlite3'] || deps.sqlite3) return { type: 'sqlite' };
    if (deps.typeorm) return { type: 'typeorm' };
    return null;
  }

  static _detectDatabase(workDir) {
    // Check all package.json files for DB deps
    const dirs = StackDetector._findPackageJsonDirs(workDir);
    for (const dir of dirs) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const db = StackDetector._detectDatabaseFromDeps(deps);
        if (db) return db;
      } catch {}
    }

    // Check for docker-compose with DB services
    const composePath = path.join(workDir, 'docker-compose.yml');
    if (fs.existsSync(composePath)) {
      const content = fs.readFileSync(composePath, 'utf-8').toLowerCase();
      if (content.includes('postgres')) return { type: 'postgresql' };
      if (content.includes('mysql')) return { type: 'mysql' };
      if (content.includes('mongo')) return { type: 'mongodb' };
      if (content.includes('redis')) return { type: 'redis' };
    }

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
