'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Generates comprehensive feature and API documentation from code analysis.
 * This documentation is used as context for better test generation.
 */
class DocumentationGenerator {
  constructor(aiProvider) {
    this.aiProvider = aiProvider;
  }

  /**
   * Generate comprehensive application documentation from analysis results.
   * @param {string} workDir - Working directory
   * @param {object} codeAnalysis - Full code analysis result
   * @param {object} techStack - Detected tech stack
   * @returns {object} - { documentation, featureDoc, apiDoc, filePath }
   */
  async generateDocumentation(workDir, codeAnalysis, techStack) {
    logger.info('📝 Generating comprehensive application documentation...');

    const startTime = Date.now();

    // Gather all source context
    const sourceContext = this._buildSourceContext(workDir, codeAnalysis, techStack);

    // Generate Feature Documentation
    logger.info('  → Generating feature documentation...');
    const featureDoc = await this._generateFeatureDocumentation(sourceContext, techStack);

    // Generate API Documentation
    logger.info('  → Generating API documentation...');
    const apiDoc = await this._generateApiDocumentation(sourceContext, codeAnalysis, techStack);

    // Generate Edge Cases & NFR Scenarios
    logger.info('  → Generating edge cases & NFR scenarios...');
    const edgeCasesDoc = await this._generateEdgeCasesAndNFR(sourceContext, featureDoc, apiDoc, techStack);

    // Combine into comprehensive documentation
    const documentation = {
      generatedAt: new Date().toISOString(),
      applicationOverview: featureDoc.applicationOverview || '',
      features: featureDoc.features || [],
      apiEndpoints: apiDoc.endpoints || [],
      dataModels: apiDoc.dataModels || [],
      authenticationFlow: apiDoc.authenticationFlow || null,
      businessRules: featureDoc.businessRules || [],
      edgeCases: edgeCasesDoc.edgeCases || [],
      nfrScenarios: edgeCasesDoc.nfrScenarios || [],
      securityConsiderations: edgeCasesDoc.securityConsiderations || [],
      errorScenarios: edgeCasesDoc.errorScenarios || [],
      integrationPoints: featureDoc.integrationPoints || [],
      userFlows: featureDoc.userFlows || []
    };

    // Write documentation to file
    const docsDir = path.join(workDir, 'generated-tests');
    fs.mkdirSync(docsDir, { recursive: true });

    const docFilePath = path.join(docsDir, 'APPLICATION-DOCUMENTATION.md');
    const markdownDoc = this._formatAsMarkdown(documentation);
    fs.writeFileSync(docFilePath, markdownDoc, 'utf-8');

    // Also write JSON version for programmatic use
    const jsonDocPath = path.join(docsDir, 'application-documentation.json');
    fs.writeFileSync(jsonDocPath, JSON.stringify(documentation, null, 2), 'utf-8');

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`✅ Documentation generated in ${duration}s`);
    logger.info(`   Features: ${documentation.features.length}`);
    logger.info(`   API Endpoints: ${documentation.apiEndpoints.length}`);
    logger.info(`   Edge Cases: ${documentation.edgeCases.length}`);
    logger.info(`   NFR Scenarios: ${documentation.nfrScenarios.length}`);
    logger.info(`   Saved to: ${path.relative(workDir, docFilePath)}`);

    return {
      documentation,
      featureDoc,
      apiDoc,
      edgeCasesDoc,
      filePath: docFilePath,
      jsonPath: jsonDocPath
    };
  }

  /**
   * Build consolidated source context for documentation generation.
   */
  _buildSourceContext(workDir, codeAnalysis, techStack) {
    const context = {
      techStack: techStack ? {
        frontend: techStack.frontend ? `${techStack.frontend.framework} (${techStack.frontend.dir || '.'})` : null,
        backend: techStack.backend ? `${techStack.backend.framework} (${techStack.backend.dir || '.'})` : null,
        language: techStack.language,
        database: techStack.database?.type || null,
        packageManager: techStack.packageManager
      } : null,
      routes: codeAnalysis.surface?.routes || [],
      apiEndpoints: codeAnalysis.surface?.apiEndpoints || [],
      components: codeAnalysis.surface?.components || [],
      models: codeAnalysis.surface?.models || [],
      fileTree: codeAnalysis.structure?.fileTree || [],
      configFiles: codeAnalysis.structure?.configFiles || {},
      deepAnalysis: codeAnalysis.analysis?.deepAnalysis || null,
      analyzedFiles: codeAnalysis.analysis?.analyzedFiles || []
    };

    // Read key source files for documentation context
    const criticalFiles = this._identifyCriticalSourceFiles(workDir, codeAnalysis);
    context.sourceFiles = {};
    for (const filePath of criticalFiles.slice(0, 25)) {
      const fullPath = path.join(workDir, filePath);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          context.sourceFiles[filePath] = content.length > 15000
            ? content.slice(0, 15000) + '\n// ... [truncated]'
            : content;
        } catch { /* skip */ }
      }
    }

    return context;
  }

  /**
   * Identify critical source files for documentation.
   */
  _identifyCriticalSourceFiles(workDir, codeAnalysis) {
    const files = new Set();

    // Route/controller files
    const routes = codeAnalysis.surface?.routes || [];
    for (const route of routes) {
      if (route.file) files.add(route.file);
    }

    // API endpoint files
    const endpoints = codeAnalysis.surface?.apiEndpoints || [];
    for (const ep of endpoints) {
      if (ep.file) files.add(ep.file);
    }

    // Model files
    const models = codeAnalysis.surface?.models || [];
    for (const model of models) {
      if (model.file) files.add(model.file);
    }

    // AI recommended critical files
    if (codeAnalysis.analysis?.aiRecommendations?.criticalFiles) {
      for (const f of codeAnalysis.analysis.aiRecommendations.criticalFiles) {
        files.add(f);
      }
    }

    // Main entry points
    const entryPoints = ['index.js', 'app.js', 'server.js', 'main.js', 'src/index.js', 'src/app.js', 'src/server.js'];
    for (const ep of entryPoints) {
      const fullPath = path.join(workDir, ep);
      if (fs.existsSync(fullPath)) files.add(ep);
    }

    // Middleware files
    const middlewareDirs = ['middleware', 'middlewares', 'src/middleware', 'src/middlewares'];
    for (const dir of middlewareDirs) {
      const fullDir = path.join(workDir, dir);
      if (fs.existsSync(fullDir)) {
        try {
          const entries = fs.readdirSync(fullDir);
          for (const entry of entries) {
            if (/\.(js|ts)$/.test(entry)) {
              files.add(path.join(dir, entry));
            }
          }
        } catch { /* skip */ }
      }
    }

    return Array.from(files);
  }

  /**
   * Generate feature documentation using AI.
   */
  async _generateFeatureDocumentation(sourceContext, techStack) {
    const prompt = `You are a senior technical writer and software architect. Analyze the provided application source code and generate comprehensive FEATURE DOCUMENTATION.

Based on the source code, routes, components, models, and configuration files provided, generate:

1. **applicationOverview**: A 2-3 paragraph description of what this application does, its purpose, and architecture.

2. **features**: An array of feature objects, each with:
   - "name": Feature name (e.g., "User Authentication", "Product Catalog")
   - "description": What this feature does
   - "components": List of related files/components
   - "userStories": Array of user story descriptions
   - "acceptanceCriteria": Array of testable acceptance criteria
   - "dependencies": External services or integrations this feature depends on

3. **businessRules**: Array of business rules with:
   - "rule": Description of the business rule
   - "context": Where it applies
   - "validationNeeded": What validation should exist

4. **integrationPoints**: Array of external integrations with:
   - "name": Integration name (e.g., "Payment Gateway", "Email Service")
   - "type": "api" | "database" | "message-queue" | "third-party"
   - "details": How it's integrated

5. **userFlows**: Array of critical user flows with:
   - "name": Flow name
   - "steps": Array of step descriptions
   - "happyPath": Expected successful outcome
   - "errorPaths": Array of possible error scenarios

Return ONLY valid JSON. No markdown formatting.`;

    try {
      const result = await this.aiProvider.analyzeCode({
        phase: 'documentation-features',
        context: sourceContext
      });
      return result || {};
    } catch (err) {
      logger.warn(`Feature documentation generation failed: ${err.message}`);
      // Build fallback from static analysis
      return this._buildFallbackFeatureDoc(sourceContext);
    }
  }

  /**
   * Generate API documentation using AI.
   */
  async _generateApiDocumentation(sourceContext, codeAnalysis, techStack) {
    const prompt = `You are an expert API documentation engineer. Analyze the provided source code and generate comprehensive API DOCUMENTATION.

Generate:

1. **endpoints**: Array of API endpoint objects, each with:
   - "method": HTTP method (GET, POST, PUT, DELETE, PATCH)
   - "path": Full endpoint path
   - "description": What this endpoint does
   - "requestBody": Expected request body schema (if applicable)
   - "queryParams": Array of query parameter objects { name, type, required, description }
   - "pathParams": Array of path parameter objects { name, type, description }
   - "headers": Required headers
   - "responseSchema": Expected response body structure
   - "statusCodes": Array of { code, description, responseExample }
   - "authentication": "required" | "optional" | "none"
   - "rateLimit": Rate limiting info if detected
   - "validationRules": Input validation rules

2. **dataModels**: Array of data model objects with:
   - "name": Model name
   - "fields": Array of { name, type, required, constraints, description }
   - "relationships": Related models
   - "validations": Built-in validation rules

3. **authenticationFlow**: Object with:
   - "type": "jwt" | "session" | "oauth" | "api-key" | "none"
   - "loginEndpoint": Path to login
   - "tokenStorage": Where tokens are stored
   - "refreshMechanism": How tokens refresh
   - "protectedRoutes": List of protected route patterns

Return ONLY valid JSON. No markdown formatting.`;

    try {
      const result = await this.aiProvider.analyzeCode({
        phase: 'documentation-api',
        context: sourceContext
      });
      return result || {};
    } catch (err) {
      logger.warn(`API documentation generation failed: ${err.message}`);
      return this._buildFallbackApiDoc(sourceContext, codeAnalysis);
    }
  }

  /**
   * Generate edge cases and NFR scenarios using AI.
   */
  async _generateEdgeCasesAndNFR(sourceContext, featureDoc, apiDoc, techStack) {
    const context = {
      ...sourceContext,
      features: featureDoc.features || [],
      apiEndpoints: apiDoc.endpoints || [],
      dataModels: apiDoc.dataModels || []
    };

    try {
      const result = await this.aiProvider.analyzeCode({
        phase: 'documentation-edge-cases',
        context
      });
      return result || {};
    } catch (err) {
      logger.warn(`Edge cases documentation failed: ${err.message}`);
      return this._buildFallbackEdgeCases(sourceContext);
    }
  }

  /**
   * Fallback feature doc from static analysis when AI fails.
   */
  _buildFallbackFeatureDoc(sourceContext) {
    const features = [];

    // Group routes by prefix to infer features
    const routeGroups = {};
    for (const route of sourceContext.routes) {
      const prefix = (route.path || '').split('/').filter(Boolean)[0] || 'main';
      if (!routeGroups[prefix]) routeGroups[prefix] = [];
      routeGroups[prefix].push(route);
    }

    for (const [prefix, routes] of Object.entries(routeGroups)) {
      features.push({
        name: prefix.charAt(0).toUpperCase() + prefix.slice(1),
        description: `Feature group for /${prefix} routes`,
        components: routes.map(r => r.file).filter(Boolean),
        userStories: [`As a user, I can access ${prefix} functionality`],
        acceptanceCriteria: routes.map(r => `${r.method} ${r.path} returns expected response`),
        dependencies: []
      });
    }

    return {
      applicationOverview: 'Application overview could not be generated (AI unavailable).',
      features,
      businessRules: [],
      integrationPoints: [],
      userFlows: []
    };
  }

  /**
   * Fallback API doc from static analysis.
   */
  _buildFallbackApiDoc(sourceContext, codeAnalysis) {
    const endpoints = sourceContext.apiEndpoints.map(ep => ({
      method: ep.method || 'GET',
      path: ep.path,
      description: `${ep.method || 'GET'} endpoint at ${ep.path}`,
      requestBody: null,
      queryParams: [],
      pathParams: this._extractPathParams(ep.path),
      headers: [],
      responseSchema: null,
      statusCodes: [
        { code: 200, description: 'Success' },
        { code: 400, description: 'Bad Request' },
        { code: 500, description: 'Internal Server Error' }
      ],
      authentication: 'unknown',
      validationRules: []
    }));

    const dataModels = (sourceContext.models || []).map(m => ({
      name: m.name,
      fields: [],
      relationships: [],
      validations: []
    }));

    return { endpoints, dataModels, authenticationFlow: null };
  }

  /**
   * Fallback edge cases from static analysis.
   */
  _buildFallbackEdgeCases(sourceContext) {
    const edgeCases = [];
    const nfrScenarios = [];

    // Generate generic edge cases for each endpoint
    for (const ep of sourceContext.apiEndpoints) {
      edgeCases.push({
        category: 'API',
        scenario: `${ep.method} ${ep.path} with empty body`,
        expectedBehavior: 'Should return 400 Bad Request'
      });
      edgeCases.push({
        category: 'API',
        scenario: `${ep.method} ${ep.path} with invalid data types`,
        expectedBehavior: 'Should return 400 with validation errors'
      });
    }

    // Generic NFR scenarios
    nfrScenarios.push(
      { category: 'Performance', scenario: 'Response time under 500ms for all API endpoints', metric: 'latency < 500ms' },
      { category: 'Security', scenario: 'All endpoints reject unauthorized access', metric: 'Returns 401/403' },
      { category: 'Reliability', scenario: 'Graceful handling of database connection failures', metric: 'Returns 503' },
      { category: 'Scalability', scenario: 'Concurrent request handling without errors', metric: '10 concurrent requests succeed' }
    );

    return {
      edgeCases,
      nfrScenarios,
      securityConsiderations: [],
      errorScenarios: []
    };
  }

  /**
   * Extract path parameters from a route path.
   */
  _extractPathParams(routePath) {
    const params = [];
    const matches = (routePath || '').match(/:(\w+)/g) || [];
    for (const match of matches) {
      params.push({ name: match.slice(1), type: 'string', description: '' });
    }
    return params;
  }

  /**
   * Format documentation as Markdown.
   */
  _formatAsMarkdown(doc) {
    let md = '# Application Documentation\n\n';
    md += `> Auto-generated by IGNIS Agent on ${doc.generatedAt}\n\n`;

    // Overview
    if (doc.applicationOverview) {
      md += '## Application Overview\n\n';
      md += `${doc.applicationOverview}\n\n`;
    }

    // Features
    if (doc.features.length > 0) {
      md += '## Features\n\n';
      for (const feature of doc.features) {
        md += `### ${feature.name}\n\n`;
        md += `${feature.description}\n\n`;
        if (feature.userStories && feature.userStories.length > 0) {
          md += '**User Stories:**\n';
          for (const story of feature.userStories) {
            md += `- ${story}\n`;
          }
          md += '\n';
        }
        if (feature.acceptanceCriteria && feature.acceptanceCriteria.length > 0) {
          md += '**Acceptance Criteria:**\n';
          for (const criteria of feature.acceptanceCriteria) {
            md += `- [ ] ${criteria}\n`;
          }
          md += '\n';
        }
      }
    }

    // API Endpoints
    if (doc.apiEndpoints.length > 0) {
      md += '## API Endpoints\n\n';
      md += '| Method | Path | Description | Auth |\n';
      md += '|--------|------|-------------|------|\n';
      for (const ep of doc.apiEndpoints) {
        md += `| ${ep.method} | ${ep.path} | ${ep.description || ''} | ${ep.authentication || 'unknown'} |\n`;
      }
      md += '\n';

      // Detailed endpoint docs
      for (const ep of doc.apiEndpoints) {
        md += `### ${ep.method} ${ep.path}\n\n`;
        if (ep.description) md += `${ep.description}\n\n`;
        if (ep.requestBody) {
          md += '**Request Body:**\n```json\n' + JSON.stringify(ep.requestBody, null, 2) + '\n```\n\n';
        }
        if (ep.queryParams && ep.queryParams.length > 0) {
          md += '**Query Parameters:**\n';
          for (const p of ep.queryParams) {
            md += `- \`${p.name}\` (${p.type}${p.required ? ', required' : ''}): ${p.description || ''}\n`;
          }
          md += '\n';
        }
        if (ep.statusCodes && ep.statusCodes.length > 0) {
          md += '**Status Codes:**\n';
          for (const sc of ep.statusCodes) {
            md += `- \`${sc.code}\`: ${sc.description || ''}\n`;
          }
          md += '\n';
        }
        if (ep.validationRules && ep.validationRules.length > 0) {
          md += '**Validation Rules:**\n';
          for (const rule of ep.validationRules) {
            md += `- ${typeof rule === 'string' ? rule : JSON.stringify(rule)}\n`;
          }
          md += '\n';
        }
      }
    }

    // Data Models
    if (doc.dataModels && doc.dataModels.length > 0) {
      md += '## Data Models\n\n';
      for (const model of doc.dataModels) {
        md += `### ${model.name}\n\n`;
        if (model.fields && model.fields.length > 0) {
          md += '| Field | Type | Required | Constraints |\n';
          md += '|-------|------|----------|-------------|\n';
          for (const field of model.fields) {
            md += `| ${field.name} | ${field.type} | ${field.required ? 'Yes' : 'No'} | ${field.constraints || ''} |\n`;
          }
          md += '\n';
        }
      }
    }

    // Authentication
    if (doc.authenticationFlow) {
      md += '## Authentication Flow\n\n';
      md += `- **Type:** ${doc.authenticationFlow.type || 'Unknown'}\n`;
      if (doc.authenticationFlow.loginEndpoint) {
        md += `- **Login Endpoint:** ${doc.authenticationFlow.loginEndpoint}\n`;
      }
      if (doc.authenticationFlow.tokenStorage) {
        md += `- **Token Storage:** ${doc.authenticationFlow.tokenStorage}\n`;
      }
      md += '\n';
    }

    // Edge Cases
    if (doc.edgeCases.length > 0) {
      md += '## Edge Cases & Boundary Conditions\n\n';
      const grouped = {};
      for (const ec of doc.edgeCases) {
        const cat = ec.category || 'General';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(ec);
      }
      for (const [category, cases] of Object.entries(grouped)) {
        md += `### ${category}\n\n`;
        for (const ec of cases) {
          md += `- **${ec.scenario}**\n  Expected: ${ec.expectedBehavior || 'N/A'}\n`;
        }
        md += '\n';
      }
    }

    // NFR Scenarios
    if (doc.nfrScenarios.length > 0) {
      md += '## Non-Functional Requirements (NFR) Scenarios\n\n';
      md += '| Category | Scenario | Metric |\n';
      md += '|----------|----------|--------|\n';
      for (const nfr of doc.nfrScenarios) {
        md += `| ${nfr.category} | ${nfr.scenario} | ${nfr.metric || ''} |\n`;
      }
      md += '\n';
    }

    // Security
    if (doc.securityConsiderations && doc.securityConsiderations.length > 0) {
      md += '## Security Considerations\n\n';
      for (const sec of doc.securityConsiderations) {
        md += `- ${typeof sec === 'string' ? sec : sec.description || JSON.stringify(sec)}\n`;
      }
      md += '\n';
    }

    // Error Scenarios
    if (doc.errorScenarios && doc.errorScenarios.length > 0) {
      md += '## Error Scenarios\n\n';
      for (const err of doc.errorScenarios) {
        md += `- **${err.scenario || err.name || 'Unknown'}**: ${err.expectedBehavior || err.handling || ''}\n`;
      }
      md += '\n';
    }

    // Business Rules
    if (doc.businessRules && doc.businessRules.length > 0) {
      md += '## Business Rules\n\n';
      for (const rule of doc.businessRules) {
        md += `- **${rule.rule}**\n  Context: ${rule.context || 'N/A'}\n  Validation: ${rule.validationNeeded || 'N/A'}\n`;
      }
      md += '\n';
    }

    return md;
  }
}

module.exports = DocumentationGenerator;
