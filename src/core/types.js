/**
 * AgentMarket Protocol — Types & Constants
 * 
 * This file defines the "protocol" layer:
 * - Item states, offer states, want states
 * - Valid state transitions (the state machine)
 * - Category taxonomy
 * 
 * Anyone building on this framework should import from here.
 */

// ─── Item condition enum ───
export const Condition = {
  NEW: 'new',
  LIKE_NEW: 'like_new',
  GOOD: 'good',
  FAIR: 'fair',
  POOR: 'poor',
};

export const CONDITION_RANK = {
  [Condition.NEW]: 5,
  [Condition.LIKE_NEW]: 4,
  [Condition.GOOD]: 3,
  [Condition.FAIR]: 2,
  [Condition.POOR]: 1,
};

// ─── Item status & transitions ───
export const ItemStatus = {
  LISTED: 'listed',
  RESERVED: 'reserved',
  SOLD: 'sold',
  CANCELLED: 'cancelled',
};

export const ITEM_TRANSITIONS = {
  [ItemStatus.LISTED]: [ItemStatus.RESERVED, ItemStatus.CANCELLED],
  [ItemStatus.RESERVED]: [ItemStatus.LISTED, ItemStatus.SOLD, ItemStatus.CANCELLED],
  [ItemStatus.SOLD]: [],
  [ItemStatus.CANCELLED]: [ItemStatus.LISTED],
};

// ─── Offer status & transitions ───
export const OfferStatus = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  COUNTERED: 'countered',
  EXPIRED: 'expired',
  SETTLED: 'settled',
};

export const OFFER_TRANSITIONS = {
  [OfferStatus.PENDING]: [OfferStatus.ACCEPTED, OfferStatus.REJECTED, OfferStatus.COUNTERED, OfferStatus.EXPIRED],
  [OfferStatus.ACCEPTED]: [OfferStatus.SETTLED],
  [OfferStatus.REJECTED]: [],
  [OfferStatus.COUNTERED]: [],
  [OfferStatus.EXPIRED]: [],
  [OfferStatus.SETTLED]: [],
};

// ─── Want status ───
export const WantStatus = {
  ACTIVE: 'active',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
};

// ─── Default categories (extensible) ───
export const Categories = [
  'electronics',
  'computers',
  'phones',
  'furniture',
  'clothing',
  'books',
  'sports',
  'toys',
  'home',
  'automotive',
  'other',
];

// ─── Validation helpers ───

export function canTransitionItem(from, to) {
  return ITEM_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canTransitionOffer(from, to) {
  return OFFER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isValidCondition(c) {
  return Object.values(Condition).includes(c);
}

export function isValidCategory(c) {
  return Categories.includes(c);
}

export function meetsCondition(itemCondition, minCondition) {
  return CONDITION_RANK[itemCondition] >= CONDITION_RANK[minCondition];
}
