/**
 * OpenAI Embedding Provider
 *
 * Uses text-embedding-3-small (1536 dims, cheap and fast).
 *
 * Setup:
 *   npm install openai
 *   export OPENAI_API_KEY=sk-...
 *   export AGENTMARKET_EMBEDDING=openai
 */

import { EmbeddingProvider } from '../core/matching.js';

export class OpenAIEmbeddingProvider extends EmbeddingProvider {
  constructor({ apiKey, model = 'text-embedding-3-small' } = {}) {
    super();
    this._apiKey = apiKey || process.env.OPENAI_API_KEY;
    this._model  = model;
    if (!this._apiKey) throw new Error('OpenAI API key is required (OPENAI_API_KEY)');
  }

  get modelName() { return this._model; }

  async embed(text) {
    // Lazy import so openai package is optional
    const { OpenAI } = await import('openai');
    if (!this._client) this._client = new OpenAI({ apiKey: this._apiKey });

    const res = await this._client.embeddings.create({
      model: this._model,
      input: text.slice(0, 8000), // token limit guard
    });
    return res.data[0].embedding;
  }
}
