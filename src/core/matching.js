/**
 * AgentMarket — Matching Engine
 *
 * Two built-in strategies:
 *   - ExactMatcher  (default, no dependencies) — keyword + price + condition filters
 *   - SemanticMatcher (requires an EmbeddingProvider) — cosine similarity on text embeddings
 *                     still applies price/category/condition as hard filters
 *
 * To plug in your own embedding model:
 *   1. Extend EmbeddingProvider and implement embed(text) → number[]
 *   2. Pass it to SemanticMatcher
 *   3. Pass SemanticMatcher to MatchingEngine
 *
 * If no provider is configured, MatchingEngine falls back to ExactMatcher automatically.
 */

import { v4 as uuid } from 'uuid';
import { meetsCondition } from './types.js';

// ─── Base strategy ───

export class MatchingStrategy {
  /** @returns {Promise<number>} 0 = no match, 1 = perfect match */
  async score(item, want) {
    throw new Error('Not implemented');
  }
}

// ─── Default: Exact / keyword matching (no dependencies, always available) ───

export class ExactMatcher extends MatchingStrategy {
  async score(item, want) {
    let s = 0;
    let factors = 0;

    if (want.category) {
      factors++;
      if (item.category === want.category) s += 1;
      else return 0;
    }

    if (want.max_price != null) {
      factors++;
      if (item.asking_price <= want.max_price) {
        s += 1 - (item.asking_price / want.max_price) * 0.5;
      } else {
        return 0;
      }
    }

    if (want.min_condition) {
      factors++;
      if (meetsCondition(item.condition, want.min_condition)) s += 1;
      else return 0;
    }

    const wantWords = want.description.toLowerCase().split(/\s+/);
    const itemText  = `${item.title} ${item.description || ''}`.toLowerCase();
    const wordMatches = wantWords.filter(w => w.length > 2 && itemText.includes(w));
    if (wantWords.length > 0) {
      factors++;
      s += wordMatches.length / wantWords.length;
    }

    return factors > 0 ? s / factors : 0;
  }
}

// ─── Embedding provider interface ───

export class EmbeddingProvider {
  /** Model identifier — stored in DB so cached vectors can be invalidated when model changes */
  get modelName() { return 'unknown'; }

  /**
   * Convert text to an embedding vector.
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async embed(text) {
    throw new Error('Not implemented');
  }
}

// ─── Semantic matcher (requires EmbeddingProvider + storage for caching) ───

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class SemanticMatcher extends MatchingStrategy {
  /**
   * @param {EmbeddingProvider} provider
   * @param {import('../storage/adapter.js').StorageAdapter} storage  — for embedding cache
   */
  constructor(provider, storage) {
    super();
    this.provider = provider;
    this.storage  = storage;
  }

  async getEmbedding(id, text) {
    const cached = await this.storage.getEmbedding(id);
    // Invalidate if model changed
    if (cached && cached.model === this.provider.modelName) {
      return JSON.parse(cached.vector);
    }
    const vector = await this.provider.embed(text);
    await this.storage.saveEmbedding({
      id,
      vector: JSON.stringify(vector),
      model:  this.provider.modelName,
      created_at: new Date().toISOString(),
    });
    return vector;
  }

  async score(item, want) {
    // Hard filters first (same gates as ExactMatcher)
    if (want.category && item.category !== want.category) return 0;
    if (want.max_price != null && item.asking_price > want.max_price) return 0;
    if (want.min_condition && !meetsCondition(item.condition, want.min_condition)) return 0;

    const itemVec = await this.getEmbedding(
      item.id,
      `${item.title} ${item.description || ''}`,
    );
    const wantVec = await this.getEmbedding(
      want.id,
      want.description,
    );

    return cosineSimilarity(itemVec, wantVec);
  }
}

// ─── Matching engine orchestrator ───

export class MatchingEngine {
  /** If no strategy is passed, falls back to ExactMatcher so the system always works. */
  constructor(storage, strategy = new ExactMatcher()) {
    this.storage  = storage;
    this.strategy = strategy;
  }

  async matchItemToWants(item) {
    const wants   = await this.storage.getActiveWants();
    const matches = [];

    for (const want of wants) {
      if (want.buyer_id === item.seller_id) continue;

      const score = await this.strategy.score(item, want);
      if (score > 0.3) {
        const match = {
          id:         uuid(),
          item_id:    item.id,
          want_id:    want.id,
          score:      Math.round(score * 100) / 100,
          created_at: new Date().toISOString(),
        };
        await this.storage.saveMatch(match);
        matches.push({ ...match, want });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  async matchWantToItems(want) {
    const items   = await this.storage.searchItems({
      category:     want.category   || undefined,
      maxPrice:     want.max_price  || undefined,
      minCondition: want.min_condition || undefined,
    });
    const matches = [];

    for (const item of items) {
      if (item.seller_id === want.buyer_id) continue;

      const score = await this.strategy.score(item, want);
      if (score > 0.3) {
        const match = {
          id:         uuid(),
          item_id:    item.id,
          want_id:    want.id,
          score:      Math.round(score * 100) / 100,
          created_at: new Date().toISOString(),
        };
        await this.storage.saveMatch(match);
        matches.push({ ...match, item });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }
}
