/**
 * AgentMarket — Storage Adapter Interface
 * 
 * Any storage backend (SQLite, PostgreSQL, cloud API, etc.)
 * must implement this interface. The core market logic only
 * talks to this interface, never to a specific database.
 * 
 * To create your own adapter:
 *   1. Extend StorageAdapter
 *   2. Implement all methods
 *   3. Pass your adapter to Market constructor
 */

export class StorageAdapter {
  // ─── Items ───
  async saveItem(item) { throw new Error('Not implemented'); }
  async getItem(id) { throw new Error('Not implemented'); }
  async updateItem(id, updates) { throw new Error('Not implemented'); }
  async searchItems(query) { throw new Error('Not implemented'); }
  async listItemsBySeller(sellerId) { throw new Error('Not implemented'); }

  // ─── Wants ───
  async saveWant(want) { throw new Error('Not implemented'); }
  async getWant(id) { throw new Error('Not implemented'); }
  async updateWant(id, updates) { throw new Error('Not implemented'); }
  async getActiveWants() { throw new Error('Not implemented'); }
  async listWantsByBuyer(buyerId) { throw new Error('Not implemented'); }

  // ─── Offers ───
  async saveOffer(offer) { throw new Error('Not implemented'); }
  async getOffer(id) { throw new Error('Not implemented'); }
  async updateOffer(id, updates) { throw new Error('Not implemented'); }
  async getOffersForItem(itemId) { throw new Error('Not implemented'); }
  async getOffersByBuyer(buyerId) { throw new Error('Not implemented'); }
  async getOffersBySeller(sellerId) { throw new Error('Not implemented'); }

  // ─── Matches ───
  async saveMatch(match) { throw new Error('Not implemented'); }
  async getMatchesForItem(itemId) { throw new Error('Not implemented'); }
  async getMatchesForWant(wantId) { throw new Error('Not implemented'); }

  // ─── Users ───
  async saveUser(user) { throw new Error('Not implemented'); }
  async getUserById(id) { throw new Error('Not implemented'); }
  async getUserByToken(token) { throw new Error('Not implemented'); }

  // ─── Embeddings (cache for semantic matching) ───
  async saveEmbedding(embedding) { throw new Error('Not implemented'); }
  async getEmbedding(id) { throw new Error('Not implemented'); }

  // ─── Market data (for pricing context) ───
  async getRecentSales({ category, limit } = {}) { throw new Error('Not implemented'); }

  // ─── Webhooks ───
  async saveWebhook(webhook) { throw new Error('Not implemented'); }
  async getWebhookByUser(userId) { throw new Error('Not implemented'); }
  async deleteWebhookByUser(userId) { throw new Error('Not implemented'); }
  async logWebhookDelivery(log) { throw new Error('Not implemented'); }
  async getWebhookDeliveries(webhookId, limit) { throw new Error('Not implemented'); }

  // ─── Lifecycle ───
  async initialize() { throw new Error('Not implemented'); }
  async close() {}
}
