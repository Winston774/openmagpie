/**
 * AgentMarket — SQLite Storage Adapter
 * 
 * Reference implementation of StorageAdapter using better-sqlite3.
 * Good for local development, single-machine setups, and demos.
 */

import Database from 'better-sqlite3';
import { StorageAdapter } from './adapter.js';

export class SQLiteAdapter extends StorageAdapter {
  constructor(dbPath = 'agentmarket.db') {
    super();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  async initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        location TEXT,
        contact TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);

      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        vector TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id TEXT NOT NULL,
        event TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        success INTEGER NOT NULL DEFAULT 0,
        delivered_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries ON webhook_deliveries(webhook_id);

      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        seller_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        asking_price REAL NOT NULL,
        condition TEXT NOT NULL DEFAULT 'good',
        status TEXT NOT NULL DEFAULT 'listed',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wants (
        id TEXT PRIMARY KEY,
        buyer_id TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT,
        max_price REAL,
        min_condition TEXT DEFAULT 'fair',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS offers (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        amount REAL NOT NULL,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        parent_offer_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES items(id)
      );

      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        want_id TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (item_id) REFERENCES items(id),
        FOREIGN KEY (want_id) REFERENCES wants(id)
      );

      CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
      CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
      CREATE INDEX IF NOT EXISTS idx_items_seller ON items(seller_id);
      CREATE INDEX IF NOT EXISTS idx_wants_status ON wants(status);
      CREATE INDEX IF NOT EXISTS idx_wants_buyer ON wants(buyer_id);
      CREATE INDEX IF NOT EXISTS idx_offers_item ON offers(item_id);
      CREATE INDEX IF NOT EXISTS idx_offers_buyer ON offers(buyer_id);
      CREATE INDEX IF NOT EXISTS idx_offers_seller ON offers(seller_id);
      CREATE INDEX IF NOT EXISTS idx_matches_item ON matches(item_id);
      CREATE INDEX IF NOT EXISTS idx_matches_want ON matches(want_id);
    `);
  }

  // ─── Users ───

  async saveUser(user) {
    this.db.prepare(`
      INSERT INTO users (id, token, name, location, contact, created_at)
      VALUES (@id, @token, @name, @location, @contact, @created_at)
    `).run(user);
    return user;
  }

  async getUserById(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  }

  async getUserByToken(token) {
    return this.db.prepare('SELECT * FROM users WHERE token = ?').get(token) || null;
  }

  // ─── Embeddings ───

  async saveEmbedding(embedding) {
    this.db.prepare(`
      INSERT INTO embeddings (id, vector, model, created_at)
      VALUES (@id, @vector, @model, @created_at)
      ON CONFLICT(id) DO UPDATE SET vector=@vector, model=@model, created_at=@created_at
    `).run(embedding);
    return embedding;
  }

  async getEmbedding(id) {
    return this.db.prepare('SELECT * FROM embeddings WHERE id = ?').get(id) || null;
  }

  // ─── Items ───

  async saveItem(item) {
    this.db.prepare(`
      INSERT INTO items (id, seller_id, title, description, category, asking_price, condition, status, created_at, updated_at)
      VALUES (@id, @seller_id, @title, @description, @category, @asking_price, @condition, @status, @created_at, @updated_at)
    `).run(item);
    return item;
  }

  async getItem(id) {
    return this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) || null;
  }

  async updateItem(id, updates) {
    const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE items SET ${fields}, updated_at = @updated_at WHERE id = @id`).run({
      ...updates,
      id,
      updated_at: new Date().toISOString(),
    });
    return this.getItem(id);
  }

  async searchItems({ category, maxPrice, minCondition, keyword, status = 'listed' } = {}) {
    let sql = 'SELECT * FROM items WHERE status = ?';
    const params = [status];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (maxPrice != null) {
      sql += ' AND asking_price <= ?';
      params.push(maxPrice);
    }
    if (keyword) {
      sql += ' AND (title LIKE ? OR description LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    let results = this.db.prepare(sql + ' ORDER BY created_at DESC').all(...params);

    // Filter by condition in JS (since it's an enum rank comparison)
    if (minCondition) {
      const { CONDITION_RANK } = await import('../core/types.js');
      const minRank = CONDITION_RANK[minCondition];
      results = results.filter(r => CONDITION_RANK[r.condition] >= minRank);
    }

    return results;
  }

  async listItemsBySeller(sellerId) {
    return this.db.prepare('SELECT * FROM items WHERE seller_id = ? ORDER BY created_at DESC').all(sellerId);
  }

  // ─── Wants ───

  async saveWant(want) {
    this.db.prepare(`
      INSERT INTO wants (id, buyer_id, description, category, max_price, min_condition, status, created_at, updated_at)
      VALUES (@id, @buyer_id, @description, @category, @max_price, @min_condition, @status, @created_at, @updated_at)
    `).run(want);
    return want;
  }

  async getWant(id) {
    return this.db.prepare('SELECT * FROM wants WHERE id = ?').get(id) || null;
  }

  async updateWant(id, updates) {
    const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE wants SET ${fields}, updated_at = @updated_at WHERE id = @id`).run({
      ...updates,
      id,
      updated_at: new Date().toISOString(),
    });
    return this.getWant(id);
  }

  async getActiveWants() {
    return this.db.prepare('SELECT * FROM wants WHERE status = ?').all('active');
  }

  async listWantsByBuyer(buyerId) {
    return this.db.prepare('SELECT * FROM wants WHERE buyer_id = ? ORDER BY created_at DESC').all(buyerId);
  }

  // ─── Offers ───

  async saveOffer(offer) {
    this.db.prepare(`
      INSERT INTO offers (id, item_id, buyer_id, seller_id, amount, message, status, parent_offer_id, created_at, updated_at)
      VALUES (@id, @item_id, @buyer_id, @seller_id, @amount, @message, @status, @parent_offer_id, @created_at, @updated_at)
    `).run(offer);
    return offer;
  }

  async getOffer(id) {
    return this.db.prepare('SELECT * FROM offers WHERE id = ?').get(id) || null;
  }

  async updateOffer(id, updates) {
    const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
    this.db.prepare(`UPDATE offers SET ${fields}, updated_at = @updated_at WHERE id = @id`).run({
      ...updates,
      id,
      updated_at: new Date().toISOString(),
    });
    return this.getOffer(id);
  }

  async getOffersForItem(itemId) {
    return this.db.prepare('SELECT * FROM offers WHERE item_id = ? ORDER BY created_at DESC').all(itemId);
  }

  async getOffersByBuyer(buyerId) {
    return this.db.prepare('SELECT * FROM offers WHERE buyer_id = ? ORDER BY created_at DESC').all(buyerId);
  }

  async getOffersBySeller(sellerId) {
    return this.db.prepare('SELECT * FROM offers WHERE seller_id = ? ORDER BY created_at DESC').all(sellerId);
  }

  // ─── Matches ───

  async saveMatch(match) {
    this.db.prepare(`
      INSERT INTO matches (id, item_id, want_id, score, created_at)
      VALUES (@id, @item_id, @want_id, @score, @created_at)
    `).run(match);
    return match;
  }

  async getMatchesForItem(itemId) {
    return this.db.prepare(`
      SELECT m.*, w.description as want_description, w.buyer_id, w.max_price, w.min_condition
      FROM matches m JOIN wants w ON m.want_id = w.id
      WHERE m.item_id = ? AND w.status = 'active'
      ORDER BY m.score DESC
    `).all(itemId);
  }

  async getMatchesForWant(wantId) {
    return this.db.prepare(`
      SELECT m.*, i.title, i.asking_price, i.condition, i.seller_id
      FROM matches m JOIN items i ON m.item_id = i.id
      WHERE m.want_id = ? AND i.status = 'listed'
      ORDER BY m.score DESC
    `).all(wantId);
  }

  // ─── Market data ───

  async getRecentSales({ category, limit = 10 } = {}) {
    // Join settled offers with their items to get final sale prices
    let sql = `
      SELECT i.title, i.condition, i.category, o.amount AS final_price, o.updated_at AS sold_at
      FROM offers o
      JOIN items i ON o.item_id = i.id
      WHERE o.status = 'settled'
    `;
    const params = [];
    if (category) {
      sql += ' AND i.category = ?';
      params.push(category);
    }
    sql += ' ORDER BY o.updated_at DESC LIMIT ?';
    params.push(limit);
    return this.db.prepare(sql).all(...params);
  }

  // ─── Webhooks ───

  async saveWebhook(webhook) {
    this.db.prepare(`
      INSERT INTO webhooks (id, user_id, url, secret, events, created_at)
      VALUES (@id, @user_id, @url, @secret, @events, @created_at)
      ON CONFLICT(user_id) DO UPDATE SET url=@url, secret=@secret, events=@events
    `).run(webhook);
    return webhook;
  }

  async getWebhookByUser(userId) {
    return this.db.prepare('SELECT * FROM webhooks WHERE user_id = ?').get(userId) || null;
  }

  async deleteWebhookByUser(userId) {
    return this.db.prepare('DELETE FROM webhooks WHERE user_id = ?').run(userId);
  }

  async logWebhookDelivery(log) {
    this.db.prepare(`
      INSERT INTO webhook_deliveries (webhook_id, event, status_code, success, delivered_at)
      VALUES (@webhook_id, @event, @status_code, @success, @delivered_at)
    `).run(log);
  }

  async getWebhookDeliveries(webhookId, limit = 20) {
    return this.db.prepare(`
      SELECT * FROM webhook_deliveries
      WHERE webhook_id = ?
      ORDER BY delivered_at DESC LIMIT ?
    `).all(webhookId, limit);
  }

  // ─── Lifecycle ───

  async close() {
    this.db.close();
  }
}
