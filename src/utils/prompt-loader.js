'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Prompt Template Loader
 * 
 * Loads prompt templates from config/prompts/ and fills placeholders.
 * This allows controlling LLM prompts without modifying code.
 * 
 * Template Syntax:
 *   {{variable}}       - Simple replacement
 *   {{#if var}}...{{/if}}  - Conditional block (truthy check)
 *   {{#each arr}}...{{/each}} - Iteration (uses {{this}}, {{@index}}, {{this.key}})
 *   {{else}} inside #if - Else branch
 */
class PromptLoader {
  constructor() {
    this.promptsDir = path.join(__dirname, '..', '..', 'config', 'prompts');
    this._cache = {};
  }

  /**
   * Load a prompt template by name and fill with context variables.
   * Falls back to null if template file doesn't exist (provider uses hardcoded).
   * 
   * @param {string} templateName - Template filename without extension (e.g., 'system-generate-tests')
   * @param {object} context - Variables to fill in the template
   * @returns {string|null} - Rendered prompt or null if template not found
   */
  load(templateName, context = {}) {
    const filePath = path.join(this.promptsDir, `${templateName}.md`);

    // Load from cache or disk
    let template;
    if (this._cache[templateName] && !process.env.PROMPT_NO_CACHE) {
      template = this._cache[templateName];
    } else {
      if (!fs.existsSync(filePath)) {
        logger.debug(`Prompt template not found: ${templateName}.md — using hardcoded fallback`);
        return null;
      }
      try {
        template = fs.readFileSync(filePath, 'utf-8');
        this._cache[templateName] = template;
      } catch (err) {
        logger.warn(`Failed to read prompt template ${templateName}: ${err.message}`);
        return null;
      }
    }

    // Render template with context
    return this._render(template, context);
  }

  /**
   * Render a template string with the given context.
   * Supports: {{var}}, {{#if var}}...{{else}}...{{/if}}, {{#each arr}}...{{/each}}
   */
  _render(template, context) {
    let result = template;

    // Process {{#each array}}...{{/each}} blocks
    result = result.replace(
      /\{\{#each\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (match, varPath, body) => {
        const arr = this._resolve(varPath, context);
        if (!Array.isArray(arr) || arr.length === 0) return '';
        return arr.map((item, index) => {
          let rendered = body;
          // Replace {{@index}} with 1-based index
          rendered = rendered.replace(/\{\{@index\}\}/g, String(index + 1));
          // Replace {{this.key}} with item properties
          if (typeof item === 'object' && item !== null) {
            rendered = rendered.replace(/\{\{this\.(\w+)\}\}/g, (_, key) => {
              return item[key] !== undefined ? String(item[key]) : '';
            });
            rendered = rendered.replace(/\{\{this\}\}/g, JSON.stringify(item));
          } else {
            rendered = rendered.replace(/\{\{this\}\}/g, String(item));
          }
          return rendered;
        }).join('');
      }
    );

    // Process {{#if var}}...{{else}}...{{/if}} blocks
    result = result.replace(
      /\{\{#if\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (match, varPath, body) => {
        const value = this._resolve(varPath, context);
        const parts = body.split('{{else}}');
        const trueBranch = parts[0] || '';
        const falseBranch = parts[1] || '';

        if (this._isTruthy(value)) {
          return this._render(trueBranch, context);
        } else {
          return this._render(falseBranch, context);
        }
      }
    );

    // Process simple {{variable}} replacements
    result = result.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, varPath) => {
      const value = this._resolve(varPath, context);
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    });

    return result;
  }

  /**
   * Resolve a dot-separated path against a context object.
   * e.g., 'appDocumentation.edgeCases' → context.appDocumentation.edgeCases
   */
  _resolve(varPath, context) {
    const parts = varPath.split('.');
    let current = context;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * Check if a value is "truthy" for template conditionals.
   */
  _isTruthy(value) {
    if (value === undefined || value === null || value === false || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }

  /**
   * Clear the template cache (useful for testing or hot-reload).
   */
  clearCache() {
    this._cache = {};
  }

  /**
   * List available prompt templates.
   */
  listTemplates() {
    if (!fs.existsSync(this.promptsDir)) return [];
    return fs.readdirSync(this.promptsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));
  }
}

// Singleton instance
const promptLoader = new PromptLoader();

module.exports = promptLoader;
