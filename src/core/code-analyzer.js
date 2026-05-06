'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'venv',
  '.idea', '.vscode', 'vendor', '.svelte-kit'
]);

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.py', '.rb', '.go', '.java', '.cs',
  '.html', '.css', '.scss', '.less'
]);

class CodeAnalyzer {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  /**
   * Layer 1: Structure scan — no AI, pure filesystem analysis.
   */
  async structureScan(workDir) {
    logger.info('Running Layer 1: Structure scan...');

    const fileTree = [];
    const stats = { totalFiles: 0, totalSize: 0, byExtension: {}, byDirectory: {} };
    const configFiles = {};

    this._walkDir(workDir, '', fileTree, stats);

    // Read key config files
    const keyConfigs = [
      'package.json', 'tsconfig.json', '.env.example',
      'docker-compose.yml', 'Dockerfile', 'Procfile',
      'next.config.js', 'next.config.mjs', 'vite.config.js', 'vite.config.ts',
      'webpack.config.js', 'angular.json', 'nuxt.config.ts'
    ];

    for (const configFile of keyConfigs) {
      const fullPath = path.join(workDir, configFile);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          configFiles[configFile] = content.length > 10000 ? content.slice(0, 10000) + '...' : content;
        } catch {
          // skip unreadable files
        }
      }
    }

    const result = {
      fileTree: this._summarizeTree(fileTree),
      stats,
      configFiles,
      directories: this._categorizeDirectories(workDir)
    };

    logger.info(`Structure scan complete: ${stats.totalFiles} files, ${(stats.totalSize / 1024).toFixed(1)}KB`);
    return result;
  }

  /**
   * Layer 2: Surface analysis — lightweight AI call.
   * Extracts routes, API endpoints, component list, models.
   */
  async surfaceAnalysis(workDir, structureResult, techStack = null) {
    logger.info('Running Layer 2: Surface analysis...');

    const routes = this._extractRoutes(workDir);
    const apiEndpoints = this._extractApiEndpoints(workDir);
    const components = this._extractComponents(workDir);
    const models = this._extractModels(workDir);

    // Ask AI to determine which files need deep-dive
    const surfaceContext = {
      fileTree: structureResult.fileTree,
      stats: structureResult.stats,
      configFiles: structureResult.configFiles,
      routes,
      apiEndpoints,
      components,
      models
    };

    // Include tech stack info for better analysis
    if (techStack) {
      surfaceContext.techStack = {
        frontend: techStack.frontend ? `${techStack.frontend.framework} (${techStack.frontend.dir || '.'})` : null,
        backend: techStack.backend ? `${techStack.backend.framework} (${techStack.backend.dir || '.'})` : null,
        language: techStack.language,
        database: techStack.database?.type || null,
        packageManager: techStack.packageManager
      };
    }

    let aiSurfaceResult = null;
    try {
      aiSurfaceResult = await this.aiProvider.analyzeCode({
        phase: 'surface',
        context: surfaceContext
      });
    } catch (err) {
      logger.warn(`AI surface analysis failed, proceeding with static analysis: ${err.message}`);
    }

    return {
      routes,
      apiEndpoints,
      components,
      models,
      aiRecommendations: aiSurfaceResult,
      surfaceContext
    };
  }

  /**
   * Layer 3: Deep-dive — targeted AI analysis of critical files.
   */
  async deepDive(workDir, surfaceResult, techStack = null) {
    logger.info('Running Layer 3: Deep-dive analysis...');

    // Determine which files to analyze in depth
    const filesToAnalyze = this._selectCriticalFiles(workDir, surfaceResult);

    // Read full content of selected files
    const fileContents = {};
    for (const filePath of filesToAnalyze) {
      const fullPath = path.join(workDir, filePath);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.length <= 50000) {
            fileContents[filePath] = content;
          } else {
            fileContents[filePath] = content.slice(0, 50000) + '\n// ... truncated ...';
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Send to AI for comprehensive analysis
    const deepDiveContext = {
      fileContents,
      routes: surfaceResult.routes,
      apiEndpoints: surfaceResult.apiEndpoints,
      components: surfaceResult.components,
      models: surfaceResult.models,
      surfaceRecommendations: surfaceResult.aiRecommendations
    };

    // Include tech stack for technology-specific best practice analysis
    if (techStack) {
      deepDiveContext.techStack = {
        frontend: techStack.frontend ? `${techStack.frontend.framework} (${techStack.frontend.dir || '.'})` : null,
        backend: techStack.backend ? `${techStack.backend.framework} (${techStack.backend.dir || '.'})` : null,
        language: techStack.language,
        database: techStack.database?.type || null,
        packageManager: techStack.packageManager
      };
    }

    const analysisResult = await this.aiProvider.analyzeCode({
      phase: 'deep-dive',
      context: deepDiveContext
    });

    logger.info('Deep-dive analysis complete');
    return {
      ...surfaceResult,
      deepAnalysis: analysisResult,
      analyzedFiles: Object.keys(fileContents)
    };
  }

  /**
   * Full analysis pipeline: Layer 1 → Layer 2 → Layer 3.
   * @param {string} workDir - Repository directory
   * @param {object} techStack - Detected technology stack (optional)
   */
  async analyze(workDir, techStack = null) {
    const structure = await this.structureScan(workDir);
    const surface = await this.surfaceAnalysis(workDir, structure, techStack);
    const deep = await this.deepDive(workDir, surface, techStack);

    return {
      structure,
      surface,
      analysis: deep,
      techStack,
      testingStrategy: deep.deepAnalysis?.testingStrategy || null
    };
  }

  // --- Private helpers ---

  _walkDir(baseDir, relativePath, fileTree, stats, depth = 0) {
    if (depth > 10) return;

    const fullDir = relativePath ? path.join(baseDir, relativePath) : baseDir;
    let entries;
    try {
      entries = fs.readdirSync(fullDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;

      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        this._walkDir(baseDir, relPath, fileTree, stats, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(ext) && ext !== '.json' && ext !== '.yml' && ext !== '.yaml' && ext !== '.md') {
          continue;
        }

        try {
          const stat = fs.statSync(path.join(fullDir, entry.name));
          fileTree.push({ path: relPath, size: stat.size, ext });
          stats.totalFiles++;
          stats.totalSize += stat.size;
          stats.byExtension[ext] = (stats.byExtension[ext] || 0) + 1;

          const dir = path.dirname(relPath);
          stats.byDirectory[dir] = (stats.byDirectory[dir] || 0) + 1;
        } catch {
          // Skip inaccessible files
        }
      }
    }
  }

  _summarizeTree(fileTree) {
    // If tree is small, return full list; otherwise, summarize
    if (fileTree.length <= 200) {
      return fileTree.map(f => f.path);
    }

    // For large repos, return a summarized view
    const dirs = {};
    for (const f of fileTree) {
      const dir = path.dirname(f.path);
      if (!dirs[dir]) dirs[dir] = { count: 0, topFiles: [] };
      dirs[dir].count++;
      if (dirs[dir].topFiles.length < 5) {
        dirs[dir].topFiles.push(f.path);
      }
    }
    return { totalFiles: fileTree.length, directories: dirs };
  }

  _categorizeDirectories(workDir) {
    const categories = {
      source: [],
      tests: [],
      config: [],
      docs: [],
      assets: []
    };

    const entries = fs.readdirSync(workDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) continue;

      const name = entry.name.toLowerCase();
      if (['src', 'lib', 'app', 'pages', 'components', 'server', 'api'].includes(name)) {
        categories.source.push(entry.name);
      } else if (['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'cypress'].includes(name)) {
        categories.tests.push(entry.name);
      } else if (['config', 'configs', 'configuration', '.github'].includes(name)) {
        categories.config.push(entry.name);
      } else if (['docs', 'documentation', 'doc'].includes(name)) {
        categories.docs.push(entry.name);
      } else if (['public', 'static', 'assets', 'images', 'media'].includes(name)) {
        categories.assets.push(entry.name);
      }
    }

    return categories;
  }

  _extractRoutes(workDir) {
    const routes = [];
    const routePatterns = [
      // Express-style: app.get('/path', ...), router.post('/path', ...)
      /(?:app|router)\.(get|post|put|patch|delete|all)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      // Next.js pages/app directory
      // Fastify: fastify.get('/path', ...)
      /fastify\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g
    ];

    this._scanSourceFiles(workDir, (content, filePath) => {
      for (const pattern of routePatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          routes.push({
            method: match[1].toUpperCase(),
            path: match[2],
            file: filePath
          });
        }
      }
    });

    // Detect Next.js/Nuxt file-based routes
    const pagesDirs = ['pages', 'app', 'src/pages', 'src/app'];
    for (const dir of pagesDirs) {
      const fullDir = path.join(workDir, dir);
      if (fs.existsSync(fullDir)) {
        this._extractFileRoutes(fullDir, dir, routes);
      }
    }

    logger.info(`Extracted ${routes.length} routes`);
    return routes;
  }

  _extractApiEndpoints(workDir) {
    const endpoints = [];
    const apiPatterns = [
      /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`](\/api[^'"`]*)['"`]/g,
      /fetch\s*\(\s*['"`](\/api[^'"`]*)['"`]/g
    ];

    this._scanSourceFiles(workDir, (content, filePath) => {
      for (const pattern of apiPatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(content)) !== null) {
          endpoints.push({
            method: match[1]?.toUpperCase() || 'GET',
            path: match[2] || match[1],
            file: filePath
          });
        }
      }
    });

    logger.info(`Extracted ${endpoints.length} API endpoints`);
    return endpoints;
  }

  _extractComponents(workDir) {
    const components = [];

    this._scanSourceFiles(workDir, (content, filePath) => {
      if (!/\.(jsx|tsx|vue|svelte)$/.test(filePath)) return;

      // React/JSX component exports
      const exportMatches = content.match(/export\s+(?:default\s+)?(?:function|class|const)\s+(\w+)/g) || [];
      for (const m of exportMatches) {
        const nameMatch = m.match(/(?:function|class|const)\s+(\w+)/);
        if (nameMatch) {
          components.push({ name: nameMatch[1], file: filePath });
        }
      }
    });

    logger.info(`Extracted ${components.length} components`);
    return components;
  }

  _extractModels(workDir) {
    const models = [];

    this._scanSourceFiles(workDir, (content, filePath) => {
      // Sequelize models
      const seqMatches = content.match(/sequelize\.define\s*\(\s*['"`](\w+)['"`]/g) || [];
      for (const m of seqMatches) {
        const name = m.match(/['"`](\w+)['"`]/);
        if (name) models.push({ name: name[1], file: filePath, orm: 'sequelize' });
      }

      // Mongoose models
      const mongoMatches = content.match(/mongoose\.model\s*\(\s*['"`](\w+)['"`]/g) || [];
      for (const m of mongoMatches) {
        const name = m.match(/['"`](\w+)['"`]/);
        if (name) models.push({ name: name[1], file: filePath, orm: 'mongoose' });
      }

      // Prisma models (from schema.prisma)
      if (filePath.endsWith('.prisma')) {
        const prismaMatches = content.match(/model\s+(\w+)\s*\{/g) || [];
        for (const m of prismaMatches) {
          const name = m.match(/model\s+(\w+)/);
          if (name) models.push({ name: name[1], file: filePath, orm: 'prisma' });
        }
      }
    });

    logger.info(`Extracted ${models.length} models`);
    return models;
  }

  _selectCriticalFiles(workDir, surfaceResult) {
    const files = new Set();

    // AI-recommended files
    if (surfaceResult.aiRecommendations?.criticalFiles) {
      for (const f of surfaceResult.aiRecommendations.criticalFiles) {
        files.add(f);
      }
    }

    // Files with routes/endpoints
    for (const route of surfaceResult.routes) {
      if (route.file) files.add(route.file);
    }
    for (const ep of surfaceResult.apiEndpoints) {
      if (ep.file) files.add(ep.file);
    }

    // Key component files (limit to 20)
    for (const comp of surfaceResult.components.slice(0, 20)) {
      if (comp.file) files.add(comp.file);
    }

    // Model files
    for (const model of surfaceResult.models) {
      if (model.file) files.add(model.file);
    }

    // Limit to 30 files for context budget
    const result = Array.from(files).slice(0, 30);
    logger.info(`Selected ${result.length} critical files for deep-dive`);
    return result;
  }

  _scanSourceFiles(workDir, callback, depth = 0) {
    if (depth > 8) return;

    let entries;
    try {
      entries = fs.readdirSync(workDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = path.join(workDir, entry.name);

      if (entry.isDirectory()) {
        this._scanSourceFiles(fullPath, callback, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTENSIONS.has(ext) || entry.name.endsWith('.prisma')) {
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const relativePath = path.relative(this._baseWorkDir || workDir, fullPath);
            callback(content, relativePath || entry.name);
          } catch {
            // Skip unreadable files
          }
        }
      }
    }
  }

  _extractFileRoutes(dir, prefix, routes, depth = 0) {
    if (depth > 5) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this._extractFileRoutes(fullPath, `${prefix}/${entry.name}`, routes, depth + 1);
      } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) {
        const routePath = `/${prefix}/${entry.name}`
          .replace(/\/index\.\w+$/, '/')
          .replace(/\.\w+$/, '')
          .replace(/\[([^\]]+)\]/g, ':$1');
        routes.push({ method: 'PAGE', path: routePath, file: `${prefix}/${entry.name}` });
      }
    }
  }
}

module.exports = CodeAnalyzer;
