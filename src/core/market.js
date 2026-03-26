/**
 * AgentMarket — Core Market Operations
 * 
 * This is the heart of the framework. All business logic lives here.
 * It depends only on the StorageAdapter interface and MatchingEngine,
 * never on a specific database or CLI library.
 * 
 * Both CLI and MCP Server call these same methods.
 */

import { v4 as uuid } from 'uuid';
import {
  ItemStatus, OfferStatus, WantStatus,
  canTransitionItem, canTransitionOffer,
  isValidCondition, isValidCategory,
  Condition,
} from './types.js';
import { MatchingEngine } from './matching.js';

export class Market {
  constructor(storage, matchingEngine = null) {
    this.storage = storage;
    this.matching = matchingEngine || new MatchingEngine(storage);
    this.eventListeners = {};
  }

  // ─── Event system (for notifications, webhooks, etc.) ───

  on(event, callback) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(callback);
  }

  emit(event, data) {
    (this.eventListeners[event] || []).forEach(cb => cb(data));
  }

  // ─── Item operations ───

  async listItem({ sellerId, title, description, category, askingPrice, condition = Condition.GOOD }) {
    if (!sellerId) throw new Error('seller_id is required');
    if (!title) throw new Error('title is required');
    if (!category || !isValidCategory(category)) {
      throw new Error(`Invalid category. Valid: electronics, computers, phones, furniture, clothing, books, sports, toys, home, automotive, other`);
    }
    if (askingPrice == null || askingPrice <= 0) throw new Error('asking_price must be positive');
    if (!isValidCondition(condition)) throw new Error(`Invalid condition. Valid: new, like_new, good, fair, poor`);

    const now = new Date().toISOString();
    const item = {
      id: uuid(),
      seller_id: sellerId,
      title,
      description: description || '',
      category,
      asking_price: askingPrice,
      condition,
      status: ItemStatus.LISTED,
      created_at: now,
      updated_at: now,
    };

    await this.storage.saveItem(item);

    // Auto-match against active wants
    const matches = await this.matching.matchItemToWants(item);
    if (matches.length > 0) {
      this.emit('matches_found', { item, matches });
    }

    this.emit('item_listed', item);
    return { item, matches };
  }

  async getItem(id) {
    const item = await this.storage.getItem(id);
    if (!item) throw new Error(`Item not found: ${id}`);
    return item;
  }

  async cancelItem(id, sellerId) {
    const item = await this.getItem(id);
    if (item.seller_id !== sellerId) throw new Error('Only the seller can cancel this item');
    if (!canTransitionItem(item.status, ItemStatus.CANCELLED)) {
      throw new Error(`Cannot cancel item in "${item.status}" status`);
    }
    return this.storage.updateItem(id, { status: ItemStatus.CANCELLED });
  }

  async myListings(sellerId) {
    return this.storage.listItemsBySeller(sellerId);
  }

  // ─── Search ───

  async search({ category, maxPrice, minCondition, keyword } = {}) {
    return this.storage.searchItems({ category, maxPrice, minCondition, keyword });
  }

  // ─── Want operations ───

  async createWant({ buyerId, description, category, maxPrice, minCondition = Condition.FAIR }) {
    if (!buyerId) throw new Error('buyer_id is required');
    if (!description) throw new Error('description is required');
    if (category && !isValidCategory(category)) {
      throw new Error(`Invalid category`);
    }
    if (minCondition && !isValidCondition(minCondition)) {
      throw new Error(`Invalid condition`);
    }

    const now = new Date().toISOString();
    const want = {
      id: uuid(),
      buyer_id: buyerId,
      description,
      category: category || null,
      max_price: maxPrice ?? null,
      min_condition: minCondition,
      status: WantStatus.ACTIVE,
      created_at: now,
      updated_at: now,
    };

    await this.storage.saveWant(want);

    // Auto-match against listed items
    const matches = await this.matching.matchWantToItems(want);
    if (matches.length > 0) {
      this.emit('matches_found', { want, matches });
    }

    this.emit('want_created', want);
    return { want, matches };
  }

  async myWants(buyerId) {
    return this.storage.listWantsByBuyer(buyerId);
  }

  async cancelWant(id, buyerId) {
    const want = await this.storage.getWant(id);
    if (!want) throw new Error(`Want not found: ${id}`);
    if (want.buyer_id !== buyerId) throw new Error('Only the buyer can cancel this want');
    return this.storage.updateWant(id, { status: WantStatus.CANCELLED });
  }

  // ─── Offer operations ───

  async makeOffer({ buyerId, itemId, amount, message }) {
    if (!buyerId) throw new Error('buyer_id is required');
    if (!itemId) throw new Error('item_id is required');
    if (amount == null || amount <= 0) throw new Error('amount must be positive');

    const item = await this.getItem(itemId);
    if (item.status !== ItemStatus.LISTED) {
      throw new Error(`Item is not available (status: ${item.status})`);
    }
    if (item.seller_id === buyerId) {
      throw new Error('Cannot make an offer on your own item');
    }

    const now = new Date().toISOString();
    const offer = {
      id: uuid(),
      item_id: itemId,
      buyer_id: buyerId,
      seller_id: item.seller_id,
      amount,
      message: message || '',
      status: OfferStatus.PENDING,
      parent_offer_id: null,
      created_at: now,
      updated_at: now,
    };

    await this.storage.saveOffer(offer);

    // Reserve the item
    await this.storage.updateItem(itemId, { status: ItemStatus.RESERVED });

    this.emit('offer_made', { offer, item });
    return { offer, item };
  }

  async respondOffer({ offerId, sellerId, action, counterAmount, message }) {
    const offer = await this.storage.getOffer(offerId);
    if (!offer) throw new Error(`Offer not found: ${offerId}`);
    if (offer.seller_id !== sellerId) throw new Error('Only the seller can respond to this offer');
    if (offer.status !== OfferStatus.PENDING) {
      throw new Error(`Offer is not pending (status: ${offer.status})`);
    }

    const validActions = ['accept', 'reject', 'counter'];
    if (!validActions.includes(action)) {
      throw new Error(`Invalid action. Valid: ${validActions.join(', ')}`);
    }

    let result = {};

    if (action === 'accept') {
      await this.storage.updateOffer(offerId, { status: OfferStatus.ACCEPTED });
      result = { offer: await this.storage.getOffer(offerId), status: 'accepted' };
      this.emit('offer_accepted', result);

    } else if (action === 'reject') {
      await this.storage.updateOffer(offerId, { status: OfferStatus.REJECTED });
      // Re-list the item
      await this.storage.updateItem(offer.item_id, { status: ItemStatus.LISTED });
      result = { offer: await this.storage.getOffer(offerId), status: 'rejected' };
      this.emit('offer_rejected', result);

    } else if (action === 'counter') {
      if (!counterAmount || counterAmount <= 0) {
        throw new Error('counter_amount is required for counter-offers');
      }
      // Mark original as countered
      await this.storage.updateOffer(offerId, { status: OfferStatus.COUNTERED });

      // Create new counter-offer (roles swap: seller proposes back to buyer)
      const now = new Date().toISOString();
      const counterOffer = {
        id: uuid(),
        item_id: offer.item_id,
        buyer_id: offer.buyer_id,
        seller_id: offer.seller_id,
        amount: counterAmount,
        message: message || '',
        status: OfferStatus.PENDING,
        parent_offer_id: offerId,
        created_at: now,
        updated_at: now,
      };
      await this.storage.saveOffer(counterOffer);

      result = { offer: counterOffer, original: offer, status: 'countered' };
      this.emit('offer_countered', result);
    }

    return result;
  }

  async respondToCounter({ offerId, buyerId, action }) {
    const offer = await this.storage.getOffer(offerId);
    if (!offer) throw new Error(`Offer not found: ${offerId}`);
    if (offer.buyer_id !== buyerId) throw new Error('Only the buyer can respond to counter-offers');
    if (offer.status !== OfferStatus.PENDING || !offer.parent_offer_id) {
      throw new Error('This is not a pending counter-offer');
    }

    if (action === 'accept') {
      await this.storage.updateOffer(offerId, { status: OfferStatus.ACCEPTED });
      const result = { offer: await this.storage.getOffer(offerId), status: 'accepted' };
      this.emit('offer_accepted', result);
      return result;
    } else if (action === 'reject') {
      await this.storage.updateOffer(offerId, { status: OfferStatus.REJECTED });
      await this.storage.updateItem(offer.item_id, { status: ItemStatus.LISTED });
      const result = { offer: await this.storage.getOffer(offerId), status: 'rejected' };
      this.emit('offer_rejected', result);
      return result;
    }

    throw new Error('Invalid action. Valid: accept, reject');
  }

  async settle(offerId) {
    const offer = await this.storage.getOffer(offerId);
    if (!offer) throw new Error(`Offer not found: ${offerId}`);
    if (offer.status !== OfferStatus.ACCEPTED) {
      throw new Error('Can only settle accepted offers');
    }

    await this.storage.updateOffer(offerId, { status: OfferStatus.SETTLED });
    await this.storage.updateItem(offer.item_id, { status: ItemStatus.SOLD });

    const result = {
      offer: await this.storage.getOffer(offerId),
      item: await this.storage.getItem(offer.item_id),
      status: 'settled',
    };

    this.emit('transaction_settled', result);
    return result;
  }

  async myOffers(userId) {
    const asBuyer = await this.storage.getOffersByBuyer(userId);
    const asSeller = await this.storage.getOffersBySeller(userId);
    return { asBuyer, asSeller };
  }

  // ─── Lifecycle ───

  async initialize() {
    await this.storage.initialize();
  }

  async close() {
    await this.storage.close();
  }
}
