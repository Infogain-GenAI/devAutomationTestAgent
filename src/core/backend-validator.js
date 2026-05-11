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
    const backendPatterns = [
      /^(src|server|backend|api)\/.*\.(js|ts|py|rb|go|java)$/,
      /^routes\/.*\.(js|ts)$/,
      /^controllers\/.*\.(js|ts)$/,
      /^services\/.*\.(js|ts)$/,
      /^models\/.*\.(js|ts)$/,
      /^middleware\/.*\.(js|ts)$/
    ];

    const backendFiles = [];
    
    if (structureResult?.fileTree) {
      this._scanForBackendFiles(structureResult.fileTree, '', backendPatterns, backendFiles);
    }

    return backendFiles;
  }

  /**
   * Recursively scan for backend files
   */
  _scanForBackendFiles(tree, currentPath, patterns, result) {
    if (Array.isArray(tree)) {
      for (const item of tree) {
        if (typeof item === 'string') {
          const filePath = path.join(currentPath, item).replace(/\\/g, '/');
          if (patterns.some(pattern => pattern.test(filePath))) {
            result.push(filePath);
          }
        } else if (typeof item === 'object') {
          for (const [key, value] of Object.entries(item)) {
            this._scanForBackendFiles(value, path.join(currentPath, key), patterns, result);
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
   * Parse endpoints from file content
   */
  _parseEndpointsFromFile(filePath, content) {
    const endpoints = [];
    
    // Pattern for Express/Node.js routes
    const routePatterns = [
      /(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
      /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi, // Decorators (NestJS, etc.)
      /Route\s*\(\s*['"`]([^'"`]+)['"`].*method\s*=\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/gi // Python Flask/Django
    ];

    for (const pattern of routePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const method = match[1].toUpperCase();
        const endpoint_path = match[2];
        
        endpoints.push({
          file: filePath,
          method,
          path: endpoint_path,
          lineNumber: this._getLineNumber(content, match.index),
          code: this._extractEndpointCode(content, match.index)
        });
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
