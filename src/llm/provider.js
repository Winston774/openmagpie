/**
 * AgentMarket — LLM Provider Interface
 *
 * A single interface for all text reasoning tasks in the framework
 * (pricing suggestions, description improvement, fraud detection, etc.)
 *
 * To add your own LLM:
 *   1. Extend LLMProvider
 *   2. Implement complete(messages) → string
 *   3. Pass to createEmbeddingProvider factory or use directly
 */

export class LLMProvider {
  /** Human-readable identifier for logging */
  get modelName() { return 'unknown'; }

  /**
   * @param {Array<{role: 'user'|'assistant'|'system', content: string}>} messages
   * @returns {Promise<string>}
   */
  async complete(messages) {
    throw new Error('Not implemented');
  }
}
