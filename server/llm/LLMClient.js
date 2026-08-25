/**
 * LLMClient - Abstraction layer for LLM API calls
 * 
 * Provides a unified interface for calling various LLM providers (OpenAI, Anthropic, etc.)
 * with built-in retry logic, error handling, and usage tracking.
 */

class LLMClient {
  constructor(config = {}) {
    this.provider = config.provider || process.env.LLM_PROVIDER || 'openai';
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = config.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    this.baseUrl = config.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
    this.maxRetries = config.maxRetries || parseInt(process.env.LLM_MAX_RETRIES || '3', 10);
    this.timeout = config.timeout || parseInt(process.env.LLM_TIMEOUT || '30000', 10);
    
    // Usage tracking
    this.usageStats = {
      totalCalls: 0,
      totalTokens: 0,
      estimatedCost: 0
    };
    
    // Cost per 1M tokens (approximate for gpt-4o-mini)
    this.costPerMillionTokens = {
      'gpt-4o-mini': { input: 0.15, output: 0.60 },
      'gpt-4o': { input: 2.50, output: 10.00 },
      'gpt-4': { input: 30.00, output: 60.00 },
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 }
    };
  }

  /**
   * Check if LLM client is enabled (API key configured)
   * @returns {boolean}
   */
  isEnabled() {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  /**
   * Make a basic LLM API call with retry logic
   * @param {string} prompt - The prompt to send to the LLM
   * @param {Object} options - Additional options (temperature, maxTokens, etc.)
   * @returns {Promise<Object>} - { success: boolean, data: any, error: string, usage: object }
   */
  async call(prompt, options = {}) {
    if (!this.isEnabled()) {
      return {
        success: false,
        data: null,
        error: 'LLM client is not enabled. API key is missing.',
        usage: null
      };
    }

    const temperature = options.temperature ?? 0.7;
    const maxTokens = options.maxTokens ?? 2000;
    const systemPrompt = options.systemPrompt || 'You are a helpful AI assistant.';

    let lastError = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        
        const response = await this._makeRequest({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens
        });

        const duration = Date.now() - startTime;
        
        if (!response.ok) {
          const errorText = await response.text();
          lastError = `HTTP ${response.status}: ${errorText}`;
          
          // Retry on 5xx errors or rate limits
          if (response.status >= 500 || response.status === 429) {
            await this._exponentialBackoff(attempt);
            continue;
          }
          
          // Don't retry on 4xx errors (except 429)
          return {
            success: false,
            data: null,
            error: lastError,
            usage: null
          };
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content || '';
        const usage = result.usage || {};
        
        // Track usage
        this._trackUsage(usage);
        
        // Log request/response (with PII redaction)
        this._logRequest(prompt, content, usage, duration);
        
        return {
          success: true,
          data: content,
          error: null,
          usage: {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
            estimatedCost: this._estimateCost(usage)
          }
        };
        
      } catch (error) {
        lastError = error.message;
        
        // Retry on network errors
        if (attempt < this.maxRetries - 1) {
          await this._exponentialBackoff(attempt);
          continue;
        }
      }
    }
    
    return {
      success: false,
      data: null,
      error: `Failed after ${this.maxRetries} attempts: ${lastError}`,
      usage: null
    };
  }

  /**
   * Make a structured LLM API call that returns JSON
   * @param {string} prompt - The prompt to send to the LLM
   * @param {Object} schema - JSON schema for structured output
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - { success: boolean, data: object, error: string, usage: object }
   */
  async callStructured(prompt, schema, options = {}) {
    if (!this.isEnabled()) {
      return {
        success: false,
        data: null,
        error: 'LLM client is not enabled. API key is missing.',
        usage: null
      };
    }

    const temperature = options.temperature ?? 0.3; // Lower temperature for structured output
    const maxTokens = options.maxTokens ?? 3000;
    const systemPrompt = options.systemPrompt || 'You are a helpful AI assistant. Return only valid JSON.';

    let lastError = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        
        const requestBody = {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
          ],
          temperature,
          max_tokens: maxTokens
        };
        
        // Add response format for structured output if supported
        if (schema && this.provider === 'openai') {
          requestBody.response_format = { type: 'json_object' };
        }
        
        const response = await this._makeRequest(requestBody);
        const duration = Date.now() - startTime;
        
        if (!response.ok) {
          const errorText = await response.text();
          lastError = `HTTP ${response.status}: ${errorText}`;
          
          // Retry on 5xx errors or rate limits
          if (response.status >= 500 || response.status === 429) {
            await this._exponentialBackoff(attempt);
            continue;
          }
          
          return {
            success: false,
            data: null,
            error: lastError,
            usage: null
          };
        }

        const result = await response.json();
        const content = result.choices?.[0]?.message?.content || '';
        const usage = result.usage || {};
        
        // Track usage
        this._trackUsage(usage);
        
        // Parse JSON from response
        let parsedData;
        try {
          parsedData = JSON.parse(content);
        } catch (parseError) {
          lastError = `Failed to parse JSON: ${parseError.message}`;
          
          // Retry with improved prompt
          if (attempt < this.maxRetries - 1) {
            await this._exponentialBackoff(attempt);
            continue;
          }
          
          return {
            success: false,
            data: null,
            error: lastError,
            usage: null
          };
        }
        
        // Log request/response
        this._logRequest(prompt, content, usage, duration);
        
        return {
          success: true,
          data: parsedData,
          error: null,
          usage: {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
            estimatedCost: this._estimateCost(usage)
          }
        };
        
      } catch (error) {
        lastError = error.message;
        
        if (attempt < this.maxRetries - 1) {
          await this._exponentialBackoff(attempt);
          continue;
        }
      }
    }
    
    return {
      success: false,
      data: null,
      error: `Failed after ${this.maxRetries} attempts: ${lastError}`,
      usage: null
    };
  }

  /**
   * Get usage statistics
   * @returns {Object} - { totalCalls, totalTokens, estimatedCost }
   */
  getUsageStats() {
    return { ...this.usageStats };
  }

  /**
   * Reset usage statistics
   */
  resetUsageStats() {
    this.usageStats = {
      totalCalls: 0,
      totalTokens: 0,
      estimatedCost: 0
    };
  }

  /**
   * Make HTTP request to LLM API
   * @private
   */
  async _makeRequest(body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Exponential backoff delay
   * @private
   */
  async _exponentialBackoff(attempt) {
    const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Track API usage
   * @private
   */
  _trackUsage(usage) {
    this.usageStats.totalCalls += 1;
    this.usageStats.totalTokens += usage.total_tokens || 0;
    this.usageStats.estimatedCost += this._estimateCost(usage);
  }

  /**
   * Estimate cost based on token usage
   * @private
   */
  _estimateCost(usage) {
    const modelCosts = this.costPerMillionTokens[this.model] || this.costPerMillionTokens['gpt-4o-mini'];
    const inputCost = (usage.prompt_tokens || 0) * modelCosts.input / 1000000;
    const outputCost = (usage.completion_tokens || 0) * modelCosts.output / 1000000;
    return inputCost + outputCost;
  }

  /**
   * Log request/response with PII redaction
   * @private
   */
  _logRequest(prompt, response, usage, duration) {
    const timestamp = new Date().toISOString();
    const redactedPrompt = this._redactPII(prompt);
    const redactedResponse = this._redactPII(response);
    
    console.log(`[LLMClient] ${timestamp} - ${this.model}`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Tokens: ${usage.total_tokens || 0} (prompt: ${usage.prompt_tokens || 0}, completion: ${usage.completion_tokens || 0})`);
    console.log(`  Cost: $${this._estimateCost(usage).toFixed(6)}`);
    console.log(`  Prompt: ${redactedPrompt.substring(0, 100)}...`);
    console.log(`  Response: ${redactedResponse.substring(0, 100)}...`);
  }

  /**
   * Redact PII from text
   * @private
   */
  _redactPII(text) {
    if (!text) return '';
    
    // Redact email addresses
    let redacted = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
    
    // Redact phone numbers
    redacted = redacted.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
    
    // Redact API keys (common patterns)
    redacted = redacted.replace(/\b(sk-|pk_live_|pk_test_)[A-Za-z0-9_-]+/g, '[API_KEY]');
    
    return redacted;
  }
}

export default LLMClient;
