#!/usr/bin/env node

/**
 * AgentMarket MCP Server
 *
 * Exposes all marketplace operations as MCP tools so AI agents
 * can interact with the marketplace programmatically.
 *
 * Run: node src/mcp.js
 * Or add to Claude Desktop / any MCP client.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuid } from 'uuid';
import { Market } from './core/market.js';
import { MatchingEngine, SemanticMatcher } from './core/matching.js';
import { SQLiteAdapter } from './storage/sqlite.js';
import { createEmbeddingProvider } from './embeddings/index.js';
import { createLLMProvider } from './llm/index.js';
import { suggestPrice } from './llm/pricing.js';
import { WebhookDispatcher } from './webhooks/dispatcher.js';

// ─── Market singleton ───

const storage  = new SQLiteAdapter(process.env.AGENTMARKET_DB || 'agentmarket.db');
const provider = await createEmbeddingProvider();
const engine   = provider
  ? new MatchingEngine(storage, new SemanticMatcher(provider, storage))
  : undefined;
const market = new Market(storage, engine);
const llm    = await createLLMProvider();
await market.initialize();
new WebhookDispatcher(storage).attach(market);

// ─── Auth helper ───

async function requireAuth(token) {
  if (!token) throw new Error('token is required');
  const user = await storage.getUserByToken(token);
  if (!user) throw new Error('Invalid token. Use the register tool to create an account.');
  return user;
}

// ─── Response helpers ───

function ok(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function fail(err) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
    isError: true,
  };
}

// ─── Tool definitions ───

const TOOLS = [
  {
    name: 'register',
    description: 'Create a new user account. Returns a token that must be saved and used for all subsequent operations.',
    inputSchema: {
      type: 'object',
      properties: {
        name:     { type: 'string', description: 'Display name' },
        location: { type: 'string', description: 'City or district (for meetups and shipping)' },
        contact:  { type: 'string', description: 'Email or phone number (revealed to counterpart after settlement)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'whoami',
    description: 'Get your user profile.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Your auth token' },
      },
      required: ['token'],
    },
  },
  {
    name: 'list_item',
    description: 'List an item for sale on the marketplace.',
    inputSchema: {
      type: 'object',
      properties: {
        token:       { type: 'string', description: 'Your auth token' },
        title:       { type: 'string', description: 'Item title' },
        description: { type: 'string', description: 'Item description' },
        category:    { type: 'string', description: 'Category: electronics, computers, phones, furniture, clothing, books, sports, toys, home, automotive, other' },
        asking_price: { type: 'number', description: 'Asking price' },
        condition:   { type: 'string', description: 'Condition: new, like_new, good, fair, poor', default: 'good' },
      },
      required: ['token', 'title', 'category', 'asking_price'],
    },
  },
  {
    name: 'search_items',
    description: 'Search for listed items. All filters are optional.',
    inputSchema: {
      type: 'object',
      properties: {
        category:      { type: 'string', description: 'Filter by category' },
        max_price:     { type: 'number', description: 'Maximum price' },
        min_condition: { type: 'string', description: 'Minimum condition: new, like_new, good, fair, poor' },
        keyword:       { type: 'string', description: 'Keyword to search in title and description' },
      },
    },
  },
  {
    name: 'create_want',
    description: 'Create a buy request (want). The system will auto-match it against listed items.',
    inputSchema: {
      type: 'object',
      properties: {
        token:         { type: 'string', description: 'Your auth token' },
        description:   { type: 'string', description: 'What you are looking for' },
        category:      { type: 'string', description: 'Preferred category' },
        max_price:     { type: 'number', description: 'Maximum budget' },
        min_condition: { type: 'string', description: 'Minimum acceptable condition', default: 'fair' },
      },
      required: ['token', 'description'],
    },
  },
  {
    name: 'make_offer',
    description: 'Make an offer on a listed item.',
    inputSchema: {
      type: 'object',
      properties: {
        token:   { type: 'string', description: 'Your auth token' },
        item_id: { type: 'string', description: 'Item ID (full UUID or first 8 characters)' },
        amount:  { type: 'number', description: 'Offer amount' },
        message: { type: 'string', description: 'Optional message to the seller' },
      },
      required: ['token', 'item_id', 'amount'],
    },
  },
  {
    name: 'respond_offer',
    description: 'Seller responds to a pending offer: accept, reject, or counter.',
    inputSchema: {
      type: 'object',
      properties: {
        token:          { type: 'string', description: 'Your auth token (must be the seller)' },
        offer_id:       { type: 'string', description: 'Offer ID (full UUID or first 8 characters)' },
        action:         { type: 'string', description: 'accept, reject, or counter' },
        counter_amount: { type: 'number', description: 'Required when action is counter' },
        message:        { type: 'string', description: 'Optional message to the buyer' },
      },
      required: ['token', 'offer_id', 'action'],
    },
  },
  {
    name: 'respond_counter',
    description: 'Buyer responds to a counter-offer: accept or reject.',
    inputSchema: {
      type: 'object',
      properties: {
        token:    { type: 'string', description: 'Your auth token (must be the buyer)' },
        offer_id: { type: 'string', description: 'Counter-offer ID (full UUID or first 8 characters)' },
        action:   { type: 'string', description: 'accept or reject' },
      },
      required: ['token', 'offer_id', 'action'],
    },
  },
  {
    name: 'settle',
    description: 'Finalize an accepted offer. Marks item as sold and reveals both parties contact info.',
    inputSchema: {
      type: 'object',
      properties: {
        token:    { type: 'string', description: 'Your auth token' },
        offer_id: { type: 'string', description: 'Accepted offer ID (full UUID or first 8 characters)' },
      },
      required: ['token', 'offer_id'],
    },
  },
  {
    name: 'my_listings',
    description: 'View all items you have listed.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Your auth token' },
      },
      required: ['token'],
    },
  },
  {
    name: 'my_offers',
    description: 'View your offers as both buyer and seller.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Your auth token' },
      },
      required: ['token'],
    },
  },
  {
    name: 'my_wants',
    description: 'View your active buy requests (wants).',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Your auth token' },
      },
      required: ['token'],
    },
  },
  {
    name: 'suggest_price',
    description:
      'Get an AI-powered price suggestion based on the item details and real market data ' +
      '(current listings + recent sales). Requires AGENTMARKET_LLM to be configured.',
    inputSchema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Item title' },
        category:    { type: 'string', description: 'Item category' },
        condition:   { type: 'string', description: 'Item condition: new, like_new, good, fair, poor' },
        description: { type: 'string', description: 'Item description (optional but improves accuracy)' },
      },
      required: ['title', 'category', 'condition'],
    },
  },
  {
    name: 'set_webhook',
    description:
      'Register or update your webhook endpoint. ' +
      'The system will POST signed JSON payloads when events occur (new offers, matches, settlements, etc.). ' +
      'Returns a signing secret — store it to verify incoming requests.',
    inputSchema: {
      type: 'object',
      properties: {
        token:  { type: 'string', description: 'Your auth token' },
        url:    { type: 'string', description: 'HTTPS endpoint to receive events' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'Events to subscribe to. Empty array = all events. ' +
            'Options: matches_found, offer_made, offer_accepted, offer_rejected, offer_countered, transaction_settled',
        },
      },
      required: ['token', 'url'],
    },
  },
  {
    name: 'remove_webhook',
    description: 'Remove your webhook endpoint.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Your auth token' },
      },
      required: ['token'],
    },
  },
  {
    name: 'webhook_info',
    description: 'Show your webhook configuration and recent delivery history.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Your auth token' },
      },
      required: ['token'],
    },
  },
];

// ─── Short ID resolver ───

async function resolveItemId(prefix) {
  if (prefix.length >= 36) return prefix;
  const items = await market.search({});
  const found = items.find(i => i.id.startsWith(prefix));
  if (!found) throw new Error(`No item found starting with "${prefix}"`);
  return found.id;
}

async function resolveOfferId(prefix) {
  if (prefix.length >= 36) return prefix;
  const rows = storage.db.prepare('SELECT id FROM offers WHERE id LIKE ?').all(`${prefix}%`);
  if (rows.length === 0) throw new Error(`No offer found starting with "${prefix}"`);
  return rows[0].id;
}

// ─── Tool handlers ───

async function handleTool(name, args) {
  switch (name) {
    case 'register': {
      const user = {
        id:         uuid(),
        token:      uuid(),
        name:       args.name,
        location:   args.location || null,
        contact:    args.contact  || null,
        created_at: new Date().toISOString(),
      };
      await storage.saveUser(user);
      return ok({
        message: 'Account created. Save your token — it cannot be recovered.',
        user: { id: user.id, name: user.name, location: user.location, contact: user.contact },
        token: user.token,
      });
    }

    case 'whoami': {
      const user = await requireAuth(args.token);
      return ok({ id: user.id, name: user.name, location: user.location, contact: user.contact, created_at: user.created_at });
    }

    case 'list_item': {
      const user = await requireAuth(args.token);
      const { item, matches } = await market.listItem({
        sellerId:    user.id,
        title:       args.title,
        description: args.description,
        category:    args.category,
        askingPrice: args.asking_price,
        condition:   args.condition || 'good',
      });
      return ok({ item, matches_found: matches.length, matches });
    }

    case 'search_items': {
      const items = await market.search({
        category:     args.category,
        maxPrice:     args.max_price,
        minCondition: args.min_condition,
        keyword:      args.keyword,
      });
      // Enrich seller names
      for (const item of items) {
        const seller = await storage.getUserById(item.seller_id);
        item.seller_name = seller ? seller.name : null;
      }
      return ok({ count: items.length, items });
    }

    case 'create_want': {
      const user = await requireAuth(args.token);
      const { want, matches } = await market.createWant({
        buyerId:      user.id,
        description:  args.description,
        category:     args.category,
        maxPrice:     args.max_price,
        minCondition: args.min_condition || 'fair',
      });
      return ok({ want, matches_found: matches.length, matches });
    }

    case 'make_offer': {
      const user = await requireAuth(args.token);
      const itemId = await resolveItemId(args.item_id);
      const { offer, item } = await market.makeOffer({
        buyerId: user.id,
        itemId,
        amount:  args.amount,
        message: args.message,
      });
      return ok({ offer, item });
    }

    case 'respond_offer': {
      const user = await requireAuth(args.token);
      const offerId = await resolveOfferId(args.offer_id);
      const result = await market.respondOffer({
        offerId,
        sellerId:      user.id,
        action:        args.action,
        counterAmount: args.counter_amount,
        message:       args.message,
      });
      return ok(result);
    }

    case 'respond_counter': {
      const user = await requireAuth(args.token);
      const offerId = await resolveOfferId(args.offer_id);
      const result = await market.respondToCounter({
        offerId,
        buyerId: user.id,
        action:  args.action,
      });
      return ok(result);
    }

    case 'settle': {
      await requireAuth(args.token);
      const offerId = await resolveOfferId(args.offer_id);
      const result = await market.settle(offerId);
      const seller = await storage.getUserById(result.offer.seller_id);
      const buyer  = await storage.getUserById(result.offer.buyer_id);
      return ok({
        status: 'settled',
        item:   result.item,
        offer:  result.offer,
        seller: seller ? { name: seller.name, location: seller.location, contact: seller.contact } : null,
        buyer:  buyer  ? { name: buyer.name,  location: buyer.location,  contact: buyer.contact  } : null,
      });
    }

    case 'my_listings': {
      const user = await requireAuth(args.token);
      const items = await market.myListings(user.id);
      return ok({ count: items.length, items });
    }

    case 'my_offers': {
      const user = await requireAuth(args.token);
      const { asBuyer, asSeller } = await market.myOffers(user.id);
      return ok({ as_buyer: asBuyer, as_seller: asSeller });
    }

    case 'my_wants': {
      const user = await requireAuth(args.token);
      const wants = await market.myWants(user.id);
      return ok({ count: wants.length, wants });
    }

    case 'suggest_price': {
      if (!llm) {
        return ok({
          error: 'LLM provider not configured. Set AGENTMARKET_LLM=anthropic or AGENTMARKET_LLM=openai.',
          available: false,
        });
      }
      const result = await suggestPrice(
        {
          title:       args.title,
          category:    args.category,
          condition:   args.condition,
          description: args.description,
        },
        storage,
        llm,
      );
      return ok(result);
    }

    case 'set_webhook': {
      const user   = await requireAuth(args.token);
      const secret = uuid();
      await storage.saveWebhook({
        id:         uuid(),
        user_id:    user.id,
        url:        args.url,
        secret,
        events:     JSON.stringify(args.events || []),
        created_at: new Date().toISOString(),
      });
      return ok({
        message: 'Webhook registered. Store the signing_secret to verify incoming requests.',
        url:     args.url,
        events:  args.events?.length ? args.events : 'all',
        signing_secret: secret,
      });
    }

    case 'remove_webhook': {
      const user = await requireAuth(args.token);
      await storage.deleteWebhookByUser(user.id);
      return ok({ message: 'Webhook removed.' });
    }

    case 'webhook_info': {
      const user    = await requireAuth(args.token);
      const webhook = await storage.getWebhookByUser(user.id);
      if (!webhook) return ok({ registered: false });
      const deliveries = await storage.getWebhookDeliveries(webhook.id, 20);
      return ok({
        registered: true,
        url:        webhook.url,
        events:     JSON.parse(webhook.events).length === 0 ? 'all' : JSON.parse(webhook.events),
        deliveries,
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server setup ───

const server = new Server(
  { name: 'agentmarket', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    return await handleTool(name, args ?? {});
  } catch (err) {
    return fail(err);
  }
});

// Cleanup on exit
process.on('SIGINT',  async () => { await market.close(); process.exit(0); });
process.on('SIGTERM', async () => { await market.close(); process.exit(0); });

const transport = new StdioServerTransport();
await server.connect(transport);
