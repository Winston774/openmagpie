/**
 * Ollama Embedding Provider (local, free, no API key needed)
 *
 * Requires Ollama running locally with an embedding model pulled.
 *
 * Setup:
 *   1. Install Ollama: https://ollama.com
 *   2. ollama pull nomic-embed-text
 *   3. export AGENTMARKET_EMBEDDING=ollama
 *   4. (optional) export AGENTMARKET_OLLAMA_URL=http://localhost:11434
 *   5. (optional) export AGENTMARKET_OLLAMA_MODEL=nomic-embed-text
 */

import { EmbeddingProvider } from '../core/matching.js';

export class OllamaEmbeddingProvider extends EmbeddingProvider {
  constructor({
    baseUrl = process.env.AGENTMARKET_OLLAMA_URL || 'http://localhost:11434',
    model   = process.env.AGENTMARKET_OLLAMA_MODEL || 'nomic-embed-text',
  } = {}) {
    super();
    this._baseUrl = baseUrl;
    this._model   = model;
  }

  get modelName() { return `ollama/${this._model}`; }

  async embed(text) {
    const res = await fetch(`${this._baseUrl}/api/embeddings`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: this._model, prompt: text }),
    });

    if (!res.ok) throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.embedding;
  }
}
