/**
 * openmagpie
 * Bring shiny things home with AI agents.
 *
 * Public API — everything you need to build on top of openmagpie.
 *
 * @example
 * import { Market, SQLiteAdapter } from 'openmagpie';
 *
 * const storage = new SQLiteAdapter('market.db');
 * const market  = new Market(storage);
 * await market.initialize();
 */

// Core
export { Market }           from './core/market.js';
export { MatchingEngine, MatchingStrategy, ExactMatcher, SemanticMatcher, EmbeddingProvider }
  from './core/matching.js';
export { ItemStatus, OfferStatus, WantStatus, Condition, Categories }
  from './core/types.js';

// Storage
export { StorageAdapter }   from './storage/adapter.js';
export { SQLiteAdapter }    from './storage/sqlite.js';

// Embeddings
export { EmbeddingProvider as BaseEmbeddingProvider } from './core/matching.js';
export { OpenAIEmbeddingProvider } from './embeddings/openai.js';
export { OllamaEmbeddingProvider } from './embeddings/ollama.js';
export { createEmbeddingProvider } from './embeddings/index.js';

// LLM
export { LLMProvider }          from './llm/provider.js';
export { AnthropicProvider }    from './llm/anthropic.js';
export { OpenAILLMProvider }    from './llm/openai.js';
export { createLLMProvider }    from './llm/index.js';
export { suggestPrice }         from './llm/pricing.js';

// Webhooks
export { WebhookDispatcher }    from './webhooks/dispatcher.js';
