/**
 * ResponseParser - Parse and validate LLM responses
 * 
 * Extracts JSON from various formats, validates against schemas,
 * and sanitizes potentially harmful content.
 */

class ResponseParser {
  /**
   * Extract JSON from text (handles multiple formats)
   * @param {string} text - Text containing JSON
   * @returns {Object|Array|null} - Parsed JSON or null
   */
  static extractJSON(text) {
    if (!text || typeof text !== 'string') {
      return null;
    }

    // Strategy 1: Direct JSON parse
    try {
      return JSON.parse(text);
    } catch (e) {
      // Continue to other strategies
    }

    // Strategy 2: Extract from ```json ... ```
    const jsonCodeBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonCodeBlockMatch) {
      try {
        return JSON.parse(jsonCodeBlockMatch[1]);
      } catch (e) {
        // Continue
      }
    }

    // Strategy 3: Extract from ``` ... ```
    const codeBlockMatch = text.match(/```\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1]);
      } catch (e) {
        // Continue
      }
    }

    // Strategy 4: Find first { ... } or [ ... ]
    const jsonObjectMatch = text.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      try {
        return JSON.parse(jsonObjectMatch[0]);
      } catch (e) {
        // Continue
      }
    }

    const jsonArrayMatch = text.match(/\[[\s\S]*\]/);
    if (jsonArrayMatch) {
      try {
        return JSON.parse(jsonArrayMatch[0]);
      } catch (e) {
        // Failed all strategies
      }
    }

    return null;
  }

  /**
   * Validate data against JSON schema
   * @param {Object} data - Data to validate
   * @param {Object} schema - JSON schema
   * @returns {Object} - { valid: boolean, errors: string[] }
   */
  static validate(data, schema) {
    const errors = [];

    if (!data) {
      errors.push('Data is null or undefined');
      return { valid: false, errors };
    }

    if (!schema) {
      return { valid: true, errors: [] };
    }

    // Check type
    if (schema.type) {
      const actualType = Array.isArray(data) ? 'array' : typeof data;
      if (schema.type !== actualType) {
        errors.push(`Expected type ${schema.type}, got ${actualType}`);
      }
    }

    // Check required fields
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in data)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Check properties
    if (schema.properties && typeof data === 'object' && !Array.isArray(data)) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in data) {
          const value = data[key];
          const propErrors = this._validateProperty(key, value, propSchema);
          errors.push(...propErrors);
        }
      }
    }

    // Check array items
    if (schema.type === 'array' && schema.items && Array.isArray(data)) {
      const minItems = schema.minItems || 0;
      const maxItems = schema.maxItems || Infinity;

      if (data.length < minItems) {
        errors.push(`Array should have at least ${minItems} items, got ${data.length}`);
      }

      if (data.length > maxItems) {
        errors.push(`Array should have at most ${maxItems} items, got ${data.length}`);
      }

      // Validate each item
      data.forEach((item, index) => {
        const itemErrors = this._validateProperty(`[${index}]`, item, schema.items);
        errors.push(...itemErrors);
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate a single property
   * @private
   */
  static _validateProperty(key, value, schema) {
    const errors = [];

    if (!schema) return errors;

    const expectedType = schema.type;
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    // Type check
    if (expectedType) {
      if (expectedType === 'integer') {
        if (!Number.isInteger(value)) {
          errors.push(`Field ${key} should be an integer, got ${typeof value}`);
        }
      } else if (expectedType !== actualType) {
        errors.push(`Field ${key} should be ${expectedType}, got ${actualType}`);
      }
    }

    // Enum check
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`Field ${key} should be one of [${schema.enum.join(', ')}], got ${value}`);
    }

    // String constraints
    if (expectedType === 'string' && typeof value === 'string') {
      if (schema.minLength && value.length < schema.minLength) {
        errors.push(`Field ${key} should be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength && value.length > schema.maxLength) {
        errors.push(`Field ${key} should be at most ${schema.maxLength} characters`);
      }
    }

    // Number constraints
    if ((expectedType === 'number' || expectedType === 'integer') && typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`Field ${key} should be at least ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`Field ${key} should be at most ${schema.maximum}`);
      }
    }

    // Array constraints
    if (expectedType === 'array' && Array.isArray(value)) {
      if (schema.minItems && value.length < schema.minItems) {
        errors.push(`Field ${key} should have at least ${schema.minItems} items`);
      }
      if (schema.maxItems && value.length > schema.maxItems) {
        errors.push(`Field ${key} should have at most ${schema.maxItems} items`);
      }
    }

    // Nested object validation
    if (expectedType === 'object' && schema.properties) {
      const nestedValidation = this.validate(value, schema);
      errors.push(...nestedValidation.errors.map(err => `${key}.${err}`));
    }

    return errors;
  }

  /**
   * Sanitize text to remove potentially harmful content
   * @param {string} text - Text to sanitize
   * @returns {string} - Sanitized text
   */
  static sanitize(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    let sanitized = text;

    // Remove script tags
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Remove event handlers
    sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');

    // Remove javascript: protocol
    sanitized = sanitized.replace(/javascript:/gi, '');

    // Remove SQL injection attempts (basic)
    const sqlPatterns = [
      /(\bDROP\s+TABLE\b)/gi,
      /(\bDELETE\s+FROM\b)/gi,
      /(\bINSERT\s+INTO\b)/gi,
      /(\bUPDATE\s+\w+\s+SET\b)/gi,
      /(;\s*DROP\s+)/gi,
      /(\bUNION\s+SELECT\b)/gi
    ];

    for (const pattern of sqlPatterns) {
      if (pattern.test(sanitized)) {
        console.warn('[ResponseParser] Potential SQL injection attempt detected and removed');
        sanitized = sanitized.replace(pattern, '[REMOVED]');
      }
    }

    // Remove potential prompt injection attempts
    const promptInjectionPatterns = [
      /ignore\s+(previous|all)\s+instructions/gi,
      /disregard\s+(previous|all)\s+instructions/gi,
      /forget\s+(previous|all)\s+instructions/gi,
      /you\s+are\s+now\s+a\s+different/gi
    ];

    for (const pattern of promptInjectionPatterns) {
      if (pattern.test(sanitized)) {
        console.warn('[ResponseParser] Potential prompt injection attempt detected and removed');
        sanitized = sanitized.replace(pattern, '[REMOVED]');
      }
    }

    return sanitized;
  }

  /**
   * Parse and validate skill tree response
   * @param {string} llmResponse - Raw LLM response
   * @returns {Object} - { skills: [], errors: [] }
   */
  static parseSkillTree(llmResponse) {
    const errors = [];
    
    const data = this.extractJSON(llmResponse);
    
    if (!data) {
      errors.push('Failed to extract JSON from response');
      return { skills: [], errors };
    }

    const schema = {
      type: 'object',
      required: ['skills'],
      properties: {
        skills: {
          type: 'array',
          minItems: 3,
          maxItems: 7,
          items: {
            type: 'object',
            required: ['id', 'name', 'description', 'level', 'days', 'topics'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              description: { type: 'string' },
              level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
              days: { type: 'integer', minimum: 1, maximum: 10 },
              topics: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } }
            }
          }
        }
      }
    };

    const validation = this.validate(data, schema);
    
    if (!validation.valid) {
      errors.push(...validation.errors);
      return { skills: data.skills || [], errors };
    }

    return { skills: data.skills, errors: [] };
  }

  /**
   * Parse and validate questions response
   * @param {string} llmResponse - Raw LLM response
   * @returns {Object} - { questions: [], errors: [] }
   */
  static parseQuestions(llmResponse) {
    const errors = [];
    
    const data = this.extractJSON(llmResponse);
    
    if (!data) {
      errors.push('Failed to extract JSON from response');
      return { questions: [], errors };
    }

    const schema = {
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          items: {
            type: 'object',
            required: ['id', 'question', 'type', 'options', 'correct', 'explanation', 'key_concepts', 'score_keywords'],
            properties: {
              id: { type: 'string' },
              question: { type: 'string' },
              type: { type: 'string', enum: ['multiple_choice', 'open_ended'] },
              options: { type: 'array', items: { type: 'string' } },
              correct: { type: 'string' },
              explanation: { type: 'string' },
              key_concepts: { type: 'array', items: { type: 'string' } },
              score_keywords: { type: 'array', items: { type: 'string' } },
              sample_good_answer: { type: 'string' }
            }
          }
        }
      }
    };

    const validation = this.validate(data, schema);
    
    if (!validation.valid) {
      errors.push(...validation.errors);
      return { questions: data.questions || [], errors };
    }

    return { questions: data.questions, errors: [] };
  }

  /**
   * Parse and validate challenge response
   * @param {string} llmResponse - Raw LLM response
   * @returns {Object} - { challenge: {}, errors: [] }
   */
  static parseChallenge(llmResponse) {
    const errors = [];
    
    const data = this.extractJSON(llmResponse);
    
    if (!data) {
      errors.push('Failed to extract JSON from response');
      return { challenge: null, errors };
    }

    const schema = {
      type: 'object',
      required: ['id', 'title', 'description', 'hints', 'evaluation_criteria', 'model_solution'],
      properties: {
        id: { type: 'string' },
        day_range: { type: 'array', items: { type: 'integer' } },
        type: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        hints: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
        evaluation_criteria: { type: 'array', minItems: 5, maxItems: 10, items: { type: 'string' } },
        model_solution: { type: 'string' }
      }
    };

    const validation = this.validate(data, schema);
    
    if (!validation.valid) {
      errors.push(...validation.errors);
      return { challenge: data, errors };
    }

    return { challenge: data, errors: [] };
  }

  /**
   * Parse and validate evaluation response
   * @param {string} llmResponse - Raw LLM response
   * @returns {Object} - { score: number, feedback: string, strengths: [], weaknesses: [], errors: [] }
   */
  static parseEvaluation(llmResponse) {
    const errors = [];
    
    const data = this.extractJSON(llmResponse);
    
    if (!data) {
      errors.push('Failed to extract JSON from response');
      return { score: 0, feedback: '', strengths: [], weaknesses: [], errors };
    }

    const schema = {
      type: 'object',
      required: ['score', 'feedback', 'strengths', 'weaknesses'],
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        feedback: { type: 'string' },
        strengths: { type: 'array', minItems: 2, items: { type: 'string' } },
        weaknesses: { type: 'array', minItems: 2, items: { type: 'string' } }
      }
    };

    const validation = this.validate(data, schema);
    
    if (!validation.valid) {
      errors.push(...validation.errors);
    }

    return {
      score: data.score || 0,
      feedback: data.feedback || '',
      strengths: data.strengths || [],
      weaknesses: data.weaknesses || [],
      errors
    };
  }
}

export default ResponseParser;
