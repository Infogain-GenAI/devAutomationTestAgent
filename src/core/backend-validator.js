'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const logger = require('../utils/logger');

class BackendValidator {
  constructor(aiProvider, config) {
    this.aiProvider = aiProvider;
    this.config = config;
    this.analysisPrompts = this._loadAnalysisPrompts();
  }

  /**
   * Load analysis prompts configuration
   */
  _loadAnalysisPrompts() {
    try {
      const promptFilePath = this.config.agent.analysisPromptFile;
      if (!promptFilePath) {
        logger.warn('Analysis prompts file path not configured, using defaults');
        return this._getDefaultPrompts();
      }
      
      // Resolve relative to project root (where package.json is)
      // Works for: local dev, GitHub Actions, and Docker containers
      const projectRoot = path.resolve(__dirname, '../..');
      const promptFile = path.isAbsolute(promptFilePath) 
        ? promptFilePath 
        : path.join(projectRoot, promptFilePath);
      
      logger.debug(`Loading analysis prompts from: ${promptFile}`);
      
      if (fs.existsSync(promptFile)) {
        const content = fs.readFileSync(promptFile, 'utf-8');
        const prompts = JSON.parse(content);
        logger.info('Analysis prompts loaded successfully');
        return prompts;
      }
      
      logger.warn(`Analysis prompts file not found at: ${promptFile}`);
      logger.warn('Using default prompts instead');
      return this._getDefaultPrompts();
    } catch (err) {
      logger.error(`Failed to load analysis prompts: ${err.message}`);
      logger.warn('Falling back to default prompts');
      return this._getDefaultPrompts();
    }
  }

  /**
   * Get default prompts if config file is missing
   */
  _getDefaultPrompts() {
    return {
      backend: {
        endpoint_validation: {
          checks: ['Security', 'Error Handling', 'Input Validation', 'Best Practices']
        },
        best_practices: {
          rules: ['RESTful Design', 'Error Handling', 'Code Quality']
        }
      }
    };
  }

  /**
   * Validate all backend endpoints in the repository
   */
  async validateBackend(workDir, structureResult) {
    logger.info('Starting comprehensive backend validation...');
    
    const backendFiles = this._identifyBackendFiles(workDir, structureResult);
    const endpoints = this._extractEndpoints(workDir, backendFiles);
    
    logger.info(`Found ${endpoints.length} backend endpoints to validate`);

    const validationResults = {
      totalEndpoints: endpoints.length,
      validatedEndpoints: 0,
      issues: [],
      summary: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0
      }
    };

    // Validate each endpoint
    for (const endpoint of endpoints) {
      try {
        const endpointIssues = await this._validateEndpoint(endpoint, workDir);
        validationResults.issues.push(...endpointIssues);
        validationResults.validatedEndpoints++;

        // Update severity counts
        for (const issue of endpointIssues) {
          validationResults.summary[issue.severity]++;
        }
      } catch (err) {
        logger.error(`Failed to validate endpoint ${endpoint.path}: ${err.message}`);
      }
    }

    logger.info(`Backend validation complete: ${validationResults.issues.length} issues found`);
    return validationResults;
  }

  /**
   * Identify backend files in the repository
   */
  _identifyBackendFiles(workDir, structureResult) {
    // Source file extensions by language
    const sourceExts = /\.(js|ts|jsx|tsx|py|rb|go|java|php|cs|rs|kt)$/;

    // Directories that commonly contain backend/API code
    const backendDirs = new Set([
      'src', 'server', 'backend', 'api', 'app',
      'routes', 'controllers', 'services', 'models',
      'middleware', 'handlers', 'endpoints', 'resolvers',
      'graphql', 'lib', 'core', 'modules', 'pkg',
      'internal', 'cmd', 'views', 'resources'
    ]);

    // Directories to always skip
    const skipDirs = new Set([
      'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
      '__pycache__', 'venv', '.venv', 'vendor', 'coverage',
      'public', 'static', 'assets', 'generated-tests',
      'test', 'tests', '__tests__', 'spec', 'e2e',
      '.github', '.vscode', 'docs', 'scripts'
    ]);

    // Files that are definitely NOT backend (frontend-only patterns)
    const frontendOnlyPatterns = [
      /\.(css|scss|less|sass|styl)$/,
      /\.(html|htm|ejs|hbs|pug|jade)$/,
      /\.(svg|png|jpg|jpeg|gif|ico|webp)$/,
      /\.(woff|woff2|ttf|eot|otf)$/,
      /\.(md|mdx|txt|yml|yaml|toml|lock)$/,
      /\.config\.(js|ts|mjs|cjs)$/,
      /\.(test|spec|stories|story)\.(js|ts|jsx|tsx)$/
    ];

    const backendFiles = [];

    // Strategy 1: Scan from fileTree if available
    if (structureResult?.fileTree) {
      this._scanForBackendFiles(structureResult.fileTree, '', null, backendFiles,
        sourceExts, backendDirs, skipDirs, frontendOnlyPatterns);
    }

    // Strategy 2: Scan from structure.files array if available
    if (backendFiles.length === 0 && structureResult?.files) {
      for (const file of structureResult.files) {
        const filePath = (file.path || file).replace(/\\/g, '/');
        if (this._isLikelyBackendFile(filePath, sourceExts, backendDirs, skipDirs, frontendOnlyPatterns)) {
          backendFiles.push(filePath);
        }
      }
    }

    // Strategy 3: Direct filesystem scan as fallback
    if (backendFiles.length === 0) {
      this._scanDirectoryForBackend(workDir, workDir, backendFiles, sourceExts, backendDirs, skipDirs, frontendOnlyPatterns);
    }

    return backendFiles;
  }

  /**
   * Check if a file path looks like a backend/API file
   */
  _isLikelyBackendFile(filePath, sourceExts, backendDirs, skipDirs, frontendOnlyPatterns) {
    // Must be a source file
    if (!sourceExts.test(filePath)) return false;

    // Must not match frontend-only patterns
    if (frontendOnlyPatterns.some(p => p.test(filePath))) return false;

    const parts = filePath.split('/').filter(Boolean);

    // Skip files in excluded directories
    if (parts.some(p => skipDirs.has(p))) return false;

    // Include if any path segment is a known backend directory
    if (parts.some(p => backendDirs.has(p))) return true;

    // Include root-level entry points
    const basename = parts[parts.length - 1];
    const entryPoints = ['index.js', 'index.ts', 'server.js', 'server.ts', 'app.js', 'app.ts',
                         'main.js', 'main.ts', 'main.go', 'main.py', 'manage.py', 'wsgi.py',
                         'asgi.py', 'urls.py', 'views.py', 'Program.cs', 'Startup.cs'];
    if (parts.length <= 2 && entryPoints.includes(basename)) return true;

    // Include files with backend-indicative names
    const backendNames = /route|controller|handler|endpoint|api|service|middleware|resolver/i;
    if (backendNames.test(basename)) return true;

    return false;
  }

  /**
   * Directly scan filesystem for backend files (fallback)
   */
  _scanDirectoryForBackend(baseDir, currentDir, result, sourceExts, backendDirs, skipDirs, frontendOnlyPatterns, depth = 0) {
    if (depth > 4) return; // Don't go too deep

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          this._scanDirectoryForBackend(baseDir, path.join(currentDir, entry.name), result,
            sourceExts, backendDirs, skipDirs, frontendOnlyPatterns, depth + 1);
        } else if (entry.isFile()) {
          const fullPath = path.join(currentDir, entry.name);
          const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
          if (this._isLikelyBackendFile(relPath, sourceExts, backendDirs, skipDirs, frontendOnlyPatterns)) {
            result.push(relPath);
          }
        }
      }
    } catch (err) {
      // Permission errors, etc.
    }
  }

  /**
   * Recursively scan fileTree for backend files
   */
  _scanForBackendFiles(tree, currentPath, _unused, result, sourceExts, backendDirs, skipDirs, frontendOnlyPatterns) {
    if (Array.isArray(tree)) {
      for (const item of tree) {
        if (typeof item === 'string') {
          const filePath = path.join(currentPath, item).replace(/\\/g, '/');
          if (this._isLikelyBackendFile(filePath, sourceExts, backendDirs, skipDirs, frontendOnlyPatterns)) {
            result.push(filePath);
          }
        } else if (typeof item === 'object') {
          for (const [key, value] of Object.entries(item)) {
            if (skipDirs.has(key)) continue;
            this._scanForBackendFiles(value, path.join(currentPath, key), null, result,
              sourceExts, backendDirs, skipDirs, frontendOnlyPatterns);
          }
        }
      }
    }
  }

  /**
   * Extract endpoints from backend files
   */
  _extractEndpoints(workDir, backendFiles) {
    const endpoints = [];

    for (const file of backendFiles) {
      try {
        const fullPath = path.join(workDir, file);
        if (!fs.existsSync(fullPath)) continue;

        const content = fs.readFileSync(fullPath, 'utf-8');
        const fileEndpoints = this._parseEndpointsFromFile(file, content);
        endpoints.push(...fileEndpoints);
      } catch (err) {
        logger.warn(`Failed to read backend file ${file}: ${err.message}`);
      }
    }

    return endpoints;
  }

  /**
   * Parse endpoints from file content — generic, framework-agnostic detection.
   * Supports: Express, Fastify, Koa, Hapi, NestJS, Next.js, Nuxt, Django, Flask, 
   * FastAPI, Spring Boot, ASP.NET, Gin, Echo, Rails, Laravel, Phoenix, and more.
   */
  _parseEndpointsFromFile(filePath, content) {
    const endpoints = [];
    const normalizedPath = filePath.replace(/\\/g, '/');

    // ═══════════════════════════════════════════════════════════════
    // 1. EXPLICIT ROUTE DEFINITIONS (any language)
    // ═══════════════════════════════════════════════════════════════

    const routePatterns = [
      // Express/Koa/Fastify: app.get('/path', ...) or router.post('/path', ...)
      // Negative lookbehind prevents matching Python decorators like @app.get
      /(?<!@)(?:router|app|server|fastify)\.(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,

      // NestJS/TypeScript decorators: @Get('/path'), @Post('/path')
      /@(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*['"`]([^'"`]*?)['"`]\s*\)/gi,

      // Hapi: { method: 'GET', path: '/users' }
      /method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]\s*,\s*path\s*:\s*['"`]([^'"`]+)['"`]/gi,
      /path\s*:\s*['"`]([^'"`]+)['"`]\s*,\s*method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/gi,

      // Python Flask/FastAPI: @app.get('/path'), @router.post('/path'), @bp.delete('/path')
      /@(?:app|router|blueprint|bp)\s*\.\s*(get|post|put|delete|patch|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi,

      // Python Flask @app.route('/path', methods=['GET', 'POST'])
      /@(?:app|blueprint|bp)\s*\.\s*route\s*\(\s*['"`]([^'"`]+)['"`]/gi,

      // Python Django urls.py: path('api/users/', views.user_list)
      /path\s*\(\s*['"`]([^'"`]+)['"`]/gi,

      // Go Gin/Echo/Chi: r.GET("/path", handler)
      /\.\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*["'`]([^"'`]+)["'`]/g,

      // Go net/http: http.HandleFunc("/path", handler)
      /HandleFunc\s*\(\s*["'`]([^"'`]+)["'`]/g,

      // Ruby Rails: get '/path', post '/path', resources :users
      /^\s*(get|post|put|patch|delete)\s+['"`]([^'"`]+)['"`]/gim,

      // PHP Laravel: Route::get('/path', ...)
      /Route\s*::\s*(get|post|put|delete|patch|any|match)\s*\(\s*['"`]([^'"`]+)['"`]/gi,

      // Java Spring Boot: @GetMapping("/path"), @RequestMapping("/path")
      /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)['"`]/gi,
      /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)['"`](?:.*?method\s*=\s*RequestMethod\.(GET|POST|PUT|DELETE|PATCH))?/gi,

      // C# ASP.NET: [HttpGet("path")], [Route("path")]
      /\[Http(Get|Post|Put|Delete|Patch)\s*\(\s*["']([^"']+)["']\s*\)\]/gi,

      // Rust Actix: web::get().to(handler), #[get("/path")]
      /#\[(get|post|put|delete|patch)\s*\(\s*"([^"]+)"\s*\)\]/gi,

      // Elixir Phoenix: get "/path", Controller, :action
      /^\s*(get|post|put|patch|delete)\s+"([^"]+)"/gim
    ];

    for (const pattern of routePatterns) {
      pattern.lastIndex = 0; // Reset regex state
      let match;
      while ((match = pattern.exec(content)) !== null) {
        let method, endpoint_path;

        // Handle different capture group orders
        if (match[1] && match[2]) {
          // Most patterns: (method, path) or (path, method)
          if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/i.test(match[1])) {
            method = match[1].toUpperCase();
            endpoint_path = match[2];
          } else if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/i.test(match[2])) {
            method = match[2].toUpperCase();
            endpoint_path = match[1];
          } else {
            method = match[1].toUpperCase();
            endpoint_path = match[2];
          }
        } else if (match[1]) {
          // Single capture (e.g. HandleFunc, Django path)
          method = 'GET';
          endpoint_path = match[1];
        } else {
          continue;
        }

        // Normalize method names from decorators
        if (method.endsWith('MAPPING')) method = method.replace('MAPPING', '');

        // Skip non-HTTP methods that may have been caught
        if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].includes(method)) {
          method = 'GET'; // Default assumption
        }

        // Clean up path
        if (endpoint_path && !endpoint_path.startsWith('/')) {
          endpoint_path = '/' + endpoint_path;
        }

        if (endpoint_path) {
          endpoints.push({
            file: filePath,
            method,
            path: endpoint_path,
            lineNumber: this._getLineNumber(content, match.index),
            code: this._extractEndpointCode(content, match.index)
          });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. FILE-BASED ROUTING (path determines the endpoint)
    // ═══════════════════════════════════════════════════════════════

    // Next.js App Router: app/api/**/route.{ts,js}
    const nextAppRoute = normalizedPath.match(/(?:src\/)?app\/api\/(.+)\/route\.(js|ts|jsx|tsx)$/);
    if (nextAppRoute) {
      const routePath = '/api/' + nextAppRoute[1].replace(/\[([^\]]+)\]/g, ':$1');
      const methodPattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(/g;
      let methodMatch;
      while ((methodMatch = methodPattern.exec(content)) !== null) {
        endpoints.push({
          file: filePath,
          method: methodMatch[1].toUpperCase(),
          path: routePath,
          lineNumber: this._getLineNumber(content, methodMatch.index),
          code: this._extractEndpointCode(content, methodMatch.index)
        });
      }
      // If no named exports found but file exists, assume GET
      if (!endpoints.some(e => e.file === filePath)) {
        endpoints.push({ file: filePath, method: 'GET', path: routePath, lineNumber: 1, code: '' });
      }
    }

    // Next.js Pages Router: pages/api/**/*.{ts,js}
    const nextPagesRoute = normalizedPath.match(/(?:src\/)?pages\/api\/(.+)\.(js|ts|jsx|tsx)$/);
    if (nextPagesRoute) {
      const routePath = '/api/' + nextPagesRoute[1].replace(/\/index$/, '').replace(/\[([^\]]+)\]/g, ':$1');
      const methodPattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|get|post|put|delete|patch)\s*\(/g;
      let methodMatch;
      while ((methodMatch = methodPattern.exec(content)) !== null) {
        endpoints.push({
          file: filePath,
          method: methodMatch[1].toUpperCase(),
          path: routePath,
          lineNumber: this._getLineNumber(content, methodMatch.index),
          code: this._extractEndpointCode(content, methodMatch.index)
        });
      }
      if (!endpoints.some(e => e.file === filePath)) {
        if (content.includes('export default') || content.includes('module.exports')) {
          endpoints.push(
            { file: filePath, method: 'GET', path: routePath, lineNumber: 1, code: '' },
            { file: filePath, method: 'POST', path: routePath, lineNumber: 1, code: '' }
          );
        }
      }
    }

    // Nuxt/Nitro server routes: server/api/**/*.ts or server/routes/**/*.ts
    const nuxtRoute = normalizedPath.match(/server\/(api|routes)\/(.+)\.(js|ts)$/);
    if (nuxtRoute && content.includes('defineEventHandler')) {
      const prefix = nuxtRoute[1] === 'api' ? '/api/' : '/';
      let routeName = nuxtRoute[2];
      // Strip method suffix from Nuxt file-based methods: items.get.ts → items
      const fileMethodMatch = routeName.match(/^(.+)\.(get|post|put|delete|patch)$/);
      const method = fileMethodMatch ? fileMethodMatch[2].toUpperCase() : 'GET';
      if (fileMethodMatch) routeName = fileMethodMatch[1];
      const routePath = prefix + routeName.replace(/\/index$/, '').replace(/\[([^\]]+)\]/g, ':$1');
      endpoints.push({
        file: filePath,
        method,
        path: routePath,
        lineNumber: this._getLineNumber(content, content.indexOf('defineEventHandler')),
        code: this._extractEndpointCode(content, content.indexOf('defineEventHandler'))
      });
    }

    // SvelteKit: src/routes/**/+server.{ts,js}
    const sveltekitRoute = normalizedPath.match(/src\/routes\/(.+)\/\+server\.(js|ts)$/);
    if (sveltekitRoute) {
      const routePath = '/' + sveltekitRoute[1].replace(/\[([^\]]+)\]/g, ':$1');
      const methodPattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)\s*\(/g;
      let methodMatch;
      while ((methodMatch = methodPattern.exec(content)) !== null) {
        endpoints.push({
          file: filePath,
          method: methodMatch[1].toUpperCase(),
          path: routePath,
          lineNumber: this._getLineNumber(content, methodMatch.index),
          code: this._extractEndpointCode(content, methodMatch.index)
        });
      }
    }

    // Remix: app/routes/*.{ts,tsx} with action/loader exports
    const remixRoute = normalizedPath.match(/app\/routes\/(.+)\.(ts|tsx|js|jsx)$/);
    if (remixRoute && (content.includes('export async function loader') || content.includes('export async function action'))) {
      let routePath = '/' + remixRoute[1].replace(/\./g, '/').replace(/\$/g, ':').replace(/\/_index$/, '');
      if (content.includes('export async function loader') || content.includes('export function loader')) {
        endpoints.push({ file: filePath, method: 'GET', path: routePath, lineNumber: 1, code: '' });
      }
      if (content.includes('export async function action') || content.includes('export function action')) {
        endpoints.push({ file: filePath, method: 'POST', path: routePath, lineNumber: 1, code: '' });
      }
    }

    return endpoints;
  }

  /**
   * Get line number from index
   */
  _getLineNumber(content, index) {
    return content.substring(0, index).split('\n').length;
  }

  /**
   * Extract code block around endpoint
   */
  _extractEndpointCode(content, startIndex) {
    const lines = content.split('\n');
    const startLine = content.substring(0, startIndex).split('\n').length - 1;
    
    // Extract ~20 lines around the endpoint
    const codeLines = lines.slice(
      Math.max(0, startLine - 5),
      Math.min(lines.length, startLine + 15)
    );
    
    return codeLines.join('\n');
  }

  /**
   * Validate a single endpoint using AI
   */
  async _validateEndpoint(endpoint, workDir) {
    const issues = [];

    // Prepare prompt for AI analysis
    const checks = this.analysisPrompts.backend?.endpoint_validation?.checks || [];
    const prompt = this._buildValidationPrompt(endpoint, checks);

    try {
      const analysis = await this.aiProvider.analyzeCode({
        phase: 'endpoint-validation',
        context: {
          endpoint: endpoint.path,
          method: endpoint.method,
          file: endpoint.file,
          code: endpoint.code,
          checks
        },
        prompt
      });

      // Parse AI response and extract issues
      if (analysis && analysis.issues) {
        for (const issue of analysis.issues) {
          issues.push({
            type: 'endpoint',
            file: endpoint.file,
            lineNumber: endpoint.lineNumber,
            endpoint: endpoint.path,
            method: endpoint.method,
            severity: issue.severity || 'medium',
            category: issue.category || 'general',
            description: issue.description,
            recommendation: issue.recommendation,
            codeSnippet: issue.codeSnippet || endpoint.code
          });
        }
      }
    } catch (err) {
      logger.error(`AI validation failed for ${endpoint.path}: ${err.message}`);
      issues.push({
        type: 'validation-error',
        file: endpoint.file,
        endpoint: endpoint.path,
        severity: 'info',
        description: `Automated validation failed: ${err.message}`
      });
    }

    return issues;
  }

  /**
   * Build validation prompt for AI
   */
  _buildValidationPrompt(endpoint, checks) {
    const template = this.analysisPrompts.backend?.endpoint_validation?.prompt_template;
    
    if (template) {
      return template
        .replace('{{endpoint_path}}', endpoint.path)
        .replace('{{http_method}}', endpoint.method)
        .replace('{{code_content}}', endpoint.code)
        .replace('{{checks_list}}', checks.join('\n- '));
    }

    return `Analyze this backend endpoint for security and best practices:

Endpoint: ${endpoint.method} ${endpoint.path}
File: ${endpoint.file}

Code:
${endpoint.code}

Check for:
${checks.map(c => `- ${c}`).join('\n')}

Provide:
1. Issues found with severity (critical/high/medium/low/info)
2. Specific recommendations
3. Code examples for fixes`;
  }

  /**
   * Validate best practices across all backend code
   */
  async validateBestPractices(workDir, backendFiles) {
    logger.info('Validating backend best practices...');

    const results = {
      totalFiles: backendFiles.length,
      validatedFiles: 0,
      issues: [],
      summary: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0
      }
    };

    for (const file of backendFiles.slice(0, 20)) { // Limit to avoid token overflow
      try {
        const fullPath = path.join(workDir, file);
        if (!fs.existsSync(fullPath)) continue;

        const content = fs.readFileSync(fullPath, 'utf-8');
        const fileIssues = await this._validateFileBestPractices(file, content);
        
        results.issues.push(...fileIssues);
        results.validatedFiles++;

        for (const issue of fileIssues) {
          results.summary[issue.severity]++;
        }
      } catch (err) {
        logger.error(`Failed to validate best practices for ${file}: ${err.message}`);
      }
    }

    logger.info(`Best practices validation complete: ${results.issues.length} issues found`);
    return results;
  }

  /**
   * Validate best practices for a single file
   */
  async _validateFileBestPractices(filePath, content) {
    const issues = [];
    const rules = this.analysisPrompts.backend?.best_practices?.rules || [];
    
    const prompt = this._buildBestPracticesPrompt(filePath, content, rules);

    try {
      const analysis = await this.aiProvider.analyzeCode({
        phase: 'best-practices',
        context: {
          file: filePath,
          code: content.length > 5000 ? content.substring(0, 5000) + '...' : content,
          rules
        },
        prompt
      });

      if (analysis && analysis.issues) {
        issues.push(...analysis.issues.map(issue => ({
          type: 'best-practice',
          file: filePath,
          lineNumber: issue.lineNumber,
          severity: issue.severity || 'medium',
          category: issue.category || 'best-practice',
          description: issue.description,
          recommendation: issue.recommendation,
          rootCause: issue.rootCause
        })));
      }
    } catch (err) {
      logger.error(`Best practices validation failed for ${filePath}: ${err.message}`);
    }

    return issues;
  }

  /**
   * Build best practices validation prompt
   */
  _buildBestPracticesPrompt(filePath, content, rules) {
    const template = this.analysisPrompts.backend?.best_practices?.prompt_template;
    
    if (template) {
      return template
        .replace('{{file_path}}', filePath)
        .replace('{{code_content}}', content)
        .replace('{{rules_list}}', rules.join('\n- '));
    }

    return `Review this backend code for best practices violations:

File: ${filePath}

Code:
${content}

Check against:
${rules.map(r => `- ${r}`).join('\n')}

Provide:
1. Issues with severity
2. Root cause analysis
3. Recommended fixes`;
  }

  /**
   * Validate endpoints by sending actual HTTP requests with sample data.
   * Runs after the app is started to verify endpoints are accessible and respond correctly.
   * @param {string} appUrl - Base URL of the running application (e.g. http://localhost:3000)
   * @param {string} workDir - Working directory for file access
   * @param {object} structureResult - Code analysis structure result
   * @param {object} codeAnalysis - Full code analysis result (contains endpoints, routes, apiContracts)
   * @returns {object} Live validation results
   */
  async validateEndpointsLive(appUrl, workDir, structureResult, codeAnalysis) {
    if (!appUrl) {
      logger.warn('No app URL provided — skipping live endpoint validation');
      return { endpoints: [], totalTested: 0, accessible: 0, failed: 0, errors: [] };
    }

    logger.info(`Starting live endpoint validation against ${appUrl}...`);

    // Collect endpoints from multiple sources
    const endpoints = this._collectEndpointsForLiveTest(workDir, structureResult, codeAnalysis);

    if (endpoints.length === 0) {
      logger.info('No endpoints discovered for live validation');
      return { endpoints: [], totalTested: 0, accessible: 0, failed: 0, errors: [] };
    }

    logger.info(`Discovered ${endpoints.length} endpoint(s) for live validation`);

    const results = {
      endpoints: [],
      totalTested: 0,
      accessible: 0,
      failed: 0,
      errors: []
    };

    for (const endpoint of endpoints) {
      const result = await this._testEndpointLive(appUrl, endpoint);
      results.endpoints.push(result);
      results.totalTested++;

      if (result.accessible) {
        results.accessible++;
        const statusIcon = result.statusCode < 400 ? '✅' : '⚠️';
        logger.info(`   ${statusIcon} ${endpoint.method} ${endpoint.path} → ${result.statusCode} (${result.responseTime}ms)`);
      } else {
        results.failed++;
        results.errors.push({ endpoint: `${endpoint.method} ${endpoint.path}`, error: result.error });
        logger.warn(`   ❌ ${endpoint.method} ${endpoint.path} → ${result.error}`);
      }
    }

    logger.info(`Live endpoint validation complete: ${results.accessible}/${results.totalTested} accessible, ${results.failed} failed`);
    return results;
  }

  /**
   * Collect endpoints for live testing from all available sources.
   */
  _collectEndpointsForLiveTest(workDir, structureResult, codeAnalysis) {
    const endpointMap = new Map(); // key: "METHOD /path" → endpoint

    // Source 1: Static extraction from backend files
    const backendFiles = this._identifyBackendFiles(workDir, structureResult);
    const staticEndpoints = this._extractEndpoints(workDir, backendFiles);
    for (const ep of staticEndpoints) {
      const key = `${ep.method} ${ep.path}`;
      if (!endpointMap.has(key)) {
        endpointMap.set(key, { method: ep.method, path: ep.path, file: ep.file, source: 'static' });
      }
    }

    // Source 2: Code analyzer extracted endpoints
    if (codeAnalysis?.endpoints) {
      for (const ep of codeAnalysis.endpoints) {
        const method = (ep.method || 'GET').toUpperCase();
        const key = `${method} ${ep.path}`;
        if (!endpointMap.has(key)) {
          endpointMap.set(key, { method, path: ep.path, file: ep.file || 'unknown', source: 'analyzer' });
        }
      }
    }

    // Source 3: Code analyzer extracted routes (convert to GET endpoints)
    if (codeAnalysis?.routes) {
      for (const route of codeAnalysis.routes) {
        // Routes are typically strings like "/api/users" or "GET /api/users"
        let method = 'GET';
        let routePath = route;
        const routeMatch = route.match(/^(GET|POST|PUT|DELETE|PATCH)\s+(.+)$/i);
        if (routeMatch) {
          method = routeMatch[1].toUpperCase();
          routePath = routeMatch[2];
        }
        const key = `${method} ${routePath}`;
        if (!endpointMap.has(key)) {
          endpointMap.set(key, { method, path: routePath, file: 'unknown', source: 'routes' });
        }
      }
    }

    // Source 4: AI-extracted API contracts from deep-dive analysis
    if (codeAnalysis?.analysis?.apiContracts) {
      for (const contract of codeAnalysis.analysis.apiContracts) {
        const method = (contract.method || 'GET').toUpperCase();
        const contractPath = contract.path || contract.endpoint;
        if (!contractPath) continue;
        const key = `${method} ${contractPath}`;
        if (!endpointMap.has(key)) {
          endpointMap.set(key, {
            method, path: contractPath, file: contract.file || 'unknown',
            source: 'api-contract',
            sampleBody: contract.requestBody || contract.sampleRequest || null
          });
        } else if (contract.requestBody || contract.sampleRequest) {
          // Enrich existing endpoint with sample data from contract
          const existing = endpointMap.get(key);
          if (!existing.sampleBody) {
            existing.sampleBody = contract.requestBody || contract.sampleRequest;
          }
        }
      }
    }

    // Add common health/status endpoints if not already present
    const commonEndpoints = [
      { method: 'GET', path: '/', source: 'default' },
      { method: 'GET', path: '/health', source: 'default' },
      { method: 'GET', path: '/api/health', source: 'default' }
    ];
    for (const ep of commonEndpoints) {
      const key = `${ep.method} ${ep.path}`;
      if (!endpointMap.has(key)) {
        endpointMap.set(key, { ...ep, file: 'default' });
      }
    }

    return Array.from(endpointMap.values());
  }

  /**
   * Send an actual HTTP request to a single endpoint and return the result.
   */
  _testEndpointLive(appUrl, endpoint) {
    return new Promise((resolve) => {
      const url = new URL(endpoint.path, appUrl);
      const transport = url.protocol === 'https:' ? https : http;
      const startTime = Date.now();

      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: endpoint.method,
        timeout: 10000,
        headers: {
          'Accept': 'application/json, text/html, */*',
          'User-Agent': 'IGNIS-TestAgent/2.0'
        }
      };

      // For methods that accept a body, send sample data
      let bodyData = null;
      if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
        if (endpoint.sampleBody && typeof endpoint.sampleBody === 'object') {
          bodyData = JSON.stringify(endpoint.sampleBody);
        } else if (endpoint.sampleBody && typeof endpoint.sampleBody === 'string') {
          bodyData = endpoint.sampleBody;
        } else {
          // Generate minimal sample data based on path
          bodyData = JSON.stringify(this._generateSampleBody(endpoint.path));
        }
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(bodyData);
      }

      const req = transport.request(options, (res) => {
        const responseTime = Date.now() - startTime;
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          let responseBody = null;
          try { responseBody = JSON.parse(body); } catch { responseBody = body.slice(0, 500); }

          resolve({
            method: endpoint.method,
            path: endpoint.path,
            file: endpoint.file,
            accessible: true,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            responseTime,
            contentType: res.headers['content-type'] || 'unknown',
            responseBody,
            bodyDataSent: bodyData ? JSON.parse(bodyData) : null
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          method: endpoint.method,
          path: endpoint.path,
          file: endpoint.file,
          accessible: false,
          error: 'Request timed out (10s)',
          responseTime: 10000
        });
      });

      req.on('error', (err) => {
        resolve({
          method: endpoint.method,
          path: endpoint.path,
          file: endpoint.file,
          accessible: false,
          error: err.message,
          responseTime: Date.now() - startTime
        });
      });

      if (bodyData) {
        req.write(bodyData);
      }
      req.end();
    });
  }

  /**
   * Generate minimal sample request body based on endpoint path.
   * Uses path segments to infer likely field names.
   */
  _generateSampleBody(endpointPath) {
    const segments = endpointPath.split('/').filter(Boolean);
    const resource = segments[segments.length - 1] || segments[segments.length - 2] || 'item';

    // Common patterns
    const singularResource = resource.endsWith('s') ? resource.slice(0, -1) : resource;

    const sampleBodies = {
      users: { name: 'Test User', email: 'test@example.com' },
      user: { name: 'Test User', email: 'test@example.com' },
      auth: { email: 'test@example.com', password: 'TestPass123!' },
      login: { email: 'test@example.com', password: 'TestPass123!' },
      register: { name: 'Test User', email: 'test@example.com', password: 'TestPass123!' },
      signup: { name: 'Test User', email: 'test@example.com', password: 'TestPass123!' },
      posts: { title: 'Test Post', content: 'Test content for validation' },
      post: { title: 'Test Post', content: 'Test content for validation' },
      comments: { text: 'Test comment', postId: 1 },
      comment: { text: 'Test comment', postId: 1 },
      products: { name: 'Test Product', price: 9.99, description: 'Test product' },
      product: { name: 'Test Product', price: 9.99, description: 'Test product' },
      orders: { productId: 1, quantity: 1 },
      order: { productId: 1, quantity: 1 },
      items: { name: 'Test Item', value: 'test' },
      todos: { title: 'Test Todo', completed: false },
      todo: { title: 'Test Todo', completed: false },
      tasks: { title: 'Test Task', status: 'pending' },
      task: { title: 'Test Task', status: 'pending' },
      messages: { content: 'Test message', recipientId: 1 },
      contacts: { name: 'Test Contact', email: 'contact@example.com' }
    };

    return sampleBodies[resource] || sampleBodies[singularResource] || { name: 'test', value: 'test' };
  }
}

module.exports = BackendValidator;
