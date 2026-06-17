'use strict';

/**
 * AI Cost Calculator — Enterprise Pricing
 * 
 * Calculates estimated and actual costs for AI API calls
 * Supports multiple providers with Enterprise tier pricing
 * 
 * Pricing updated: June 2026
 */
class AICostCalculator {
  constructor(aiProvider = 'openai') {
    this.aiProvider = aiProvider || 'openai';
    
    // Enterprise Tier Pricing (per 1K tokens)
    this.enterprisePricing = {
      openai: {
        'gpt-4-turbo': {
          input: 0.01,      // $0.01 per 1K input tokens
          output: 0.03,     // $0.03 per 1K output tokens
          displayName: 'GPT-4 Turbo'
        },
        'gpt-4': {
          input: 0.03,
          output: 0.06,
          displayName: 'GPT-4'
        },
        'gpt-3.5-turbo': {
          input: 0.0005,
          output: 0.0015,
          displayName: 'GPT-3.5 Turbo'
        }
      },
      claude: {
        'claude-sonnet-4': {
          input: 0.003,     // $0.003 per 1K input tokens
          output: 0.015,    // $0.015 per 1K output tokens
          displayName: 'Claude Sonnet 4'
        },
        'claude-opus': {
          input: 0.015,
          output: 0.075,
          displayName: 'Claude Opus'
        },
        'claude-haiku': {
          input: 0.00080,
          output: 0.0024,
          displayName: 'Claude Haiku'
        }
      },
      gemini: {
        'gemini-pro': {
          input: 0.00375,   // $0.00375 per 1K input tokens
          output: 0.015,    // $0.015 per 1K output tokens
          displayName: 'Gemini Pro'
        },
        'gemini-ultra': {
          input: 0.01,
          output: 0.03,
          displayName: 'Gemini Ultra'
        }
      }
    };

    // Map provider names to canonical format
    this.providerMap = {
      'openai': 'openai',
      'gpt': 'openai',
      'claude': 'claude',
      'anthropic': 'claude',
      'gemini': 'gemini',
      'google': 'gemini'
    };

    this.canonicalProvider = this._getCanonicalProvider(aiProvider);
    this.selectedModel = this._getDefaultModel(this.canonicalProvider);
  }

  /**
   * Calculate cost for tokens
   * @param {number} inputTokens - Number of input tokens
   * @param {number} outputTokens - Number of output tokens
   * @returns {object} - { estimated: number, breakdown: {...}, formattedCost: string }
   */
  calculateCost(inputTokens = 0, outputTokens = 0) {
    const pricing = this._getPricing();
    
    if (!pricing) {
      return {
        estimated: 0,
        breakdown: null,
        formattedCost: 'N/A',
        error: `Unknown provider or model: ${this.aiProvider}`
      };
    }

    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;
    const totalCost = inputCost + outputCost;

    return {
      estimated: parseFloat(totalCost.toFixed(4)),
      breakdown: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        inputCost: parseFloat(inputCost.toFixed(4)),
        outputCost: parseFloat(outputCost.toFixed(4))
      },
      formattedCost: `$${totalCost.toFixed(4)}`,
      model: this.selectedModel,
      provider: this.canonicalProvider
    };
  }

  /**
   * Estimate cost for full analysis run (typical token usage)
   * @returns {object} - Cost estimation for standard full analysis
   */
  estimateFullAnalysisCost() {
    // Typical full analysis: 25K tokens
    // Assumption: 15K input, 10K output
    return this.calculateCost(15000, 10000);
  }

  /**
   * Estimate cost for cached/partial update (minimal tokens)
   * @returns {object} - Cost estimation for cached update
   */
  estimateCachedUpdateCost() {
    // Cached update: ~2K tokens
    // Assumption: 1.2K input, 0.8K output
    return this.calculateCost(1200, 800);
  }

  /**
   * Estimate cost for full vs. cache hit scenario
   * @returns {object} - Comparison of costs
   */
  estimateCostComparison() {
    const fullCost = this.estimateFullAnalysisCost();
    const cachedCost = this.estimateCachedUpdateCost();
    const savings = fullCost.estimated - cachedCost.estimated;
    const savingsPercent = ((savings / fullCost.estimated) * 100).toFixed(1);

    return {
      fullAnalysisCost: fullCost.estimated,
      cachedUpdateCost: cachedCost.estimated,
      potentialSavingsPerRun: parseFloat(savings.toFixed(4)),
      savingsPercentage: parseFloat(savingsPercent),
      savingsFormattedPerRun: `$${savings.toFixed(4)}`,
      dailySavingsAt10Runs: parseFloat((savings * 10).toFixed(4)),
      weeklySavingsAt70Runs: parseFloat((savings * 70).toFixed(4)),
      monthlySavingsAt300Runs: parseFloat((savings * 300).toFixed(4))
    };
  }

  /**
   * Get pricing for current provider/model
   * @private
   */
  _getPricing() {
    const provider = this.canonicalProvider;
    const model = this.selectedModel;
    
    return this.enterprisePricing[provider]?.[model] || null;
  }

  /**
   * Get canonical provider name
   * @private
   */
  _getCanonicalProvider(provider) {
    const normalized = provider?.toLowerCase().trim() || 'openai';
    return this.providerMap[normalized] || 'openai';
  }

  /**
   * Get default model for provider
   * @private
   */
  _getDefaultModel(provider) {
    const defaults = {
      'openai': 'gpt-4-turbo',
      'claude': 'claude-sonnet-4',
      'gemini': 'gemini-pro'
    };
    return defaults[provider] || 'gpt-4-turbo';
  }

  /**
   * Set model for cost calculation
   */
  setModel(modelName) {
    const provider = this.canonicalProvider;
    if (this.enterprisePricing[provider]?.[modelName]) {
      this.selectedModel = modelName;
      return true;
    }
    return false;
  }

  /**
   * Get all available models for current provider
   */
  getAvailableModels() {
    return Object.keys(this.enterprisePricing[this.canonicalProvider] || {});
  }

  /**
   * Get model display name
   */
  getModelDisplayName() {
    const pricing = this._getPricing();
    return pricing?.displayName || this.selectedModel;
  }

  /**
   * Format cost breakdown for logging
   */
  formatCostBreakdown(inputTokens, outputTokens) {
    const cost = this.calculateCost(inputTokens, outputTokens);
    
    return {
      model: this.getModelDisplayName(),
      provider: this.canonicalProvider.toUpperCase(),
      tokens: {
        input: inputTokens.toLocaleString(),
        output: outputTokens.toLocaleString(),
        total: (inputTokens + outputTokens).toLocaleString()
      },
      cost: cost.formattedCost,
      breakdown: `${cost.breakdown.inputCost.toFixed(4)} (input) + ${cost.breakdown.outputCost.toFixed(4)} (output)`
    };
  }

  /**
   * Get summary string for logging
   */
  getSummaryCostString(inputTokens, outputTokens) {
    const cost = this.calculateCost(inputTokens, outputTokens);
    const pricing = this._getPricing();
    return `${cost.formattedCost} (${cost.breakdown.totalTokens.toLocaleString()} tokens × ${this.getModelDisplayName()})`;
  }
}

module.exports = AICostCalculator;
