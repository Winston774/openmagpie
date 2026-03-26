#!/usr/bin/env node

/**
 * AgentMarket CLI
 *
 * Usage:
 *   agentmarket register --name "Alice" --location "台北市" --contact "alice@email.com"
 *   agentmarket list --token <token> --title "MacBook Pro 2022" --category computers --price 25000 --condition good
 *   agentmarket search --category computers --max-price 30000
 *   agentmarket want --token <token> --description "MacBook under 30000" --category computers --max-price 30000
 *   agentmarket offer --token <token> --item <item-id> --amount 22000
 *   agentmarket respond --token <token> --offer <offer-id> --action accept
 *   agentmarket settle --token <token> --offer <offer-id>
 *   agentmarket my-listings --token <token>
 *   agentmarket my-offers --token <token>
 *   agentmarket my-wants --token <token>
 *   agentmarket whoami --token <token>
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { v4 as uuid } from 'uuid';
import { Market } from './core/market.js';
import { MatchingEngine, SemanticMatcher } from './core/matching.js';
import { SQLiteAdapter } from './storage/sqlite.js';
import { Categories, Condition } from './core/types.js';
import { createEmbeddingProvider } from './embeddings/index.js';
import { createLLMProvider } from './llm/index.js';
import { suggestPrice } from './llm/pricing.js';
import { WebhookDispatcher } from './webhooks/dispatcher.js';

// ─── Helpers ───

function shortId(id) {
  return id.slice(0, 8);
}

function formatPrice(p) {
  return `$${Number(p).toLocaleString()}`;
}

function statusBadge(status) {
  const colors = {
    listed: chalk.green,
    reserved: chalk.yellow,
    sold: chalk.blue,
    cancelled: chalk.gray,
    active: chalk.green,
    fulfilled: chalk.blue,
    pending: chalk.yellow,
    accepted: chalk.green,
    rejected: chalk.red,
    countered: chalk.magenta,
    settled: chalk.cyan,
    expired: chalk.gray,
  };
  return (colors[status] || chalk.white)(status.toUpperCase());
}

function printItem(item) {
  console.log(`  ${chalk.bold(item.title)}`);
  console.log(`    ID: ${chalk.dim(shortId(item.id))}  Seller: ${item.seller_id}  Price: ${formatPrice(item.asking_price)}`);
  console.log(`    Category: ${item.category}  Condition: ${item.condition}  Status: ${statusBadge(item.status)}`);
  if (item.description) console.log(`    ${chalk.dim(item.description)}`);
  console.log();
}

function printOffer(offer) {
  console.log(`  Offer ${chalk.dim(shortId(offer.id))}: ${formatPrice(offer.amount)} → Item ${chalk.dim(shortId(offer.item_id))}`);
  console.log(`    Buyer: ${offer.buyer_id}  Seller: ${offer.seller_id}  Status: ${statusBadge(offer.status)}`);
  if (offer.message) console.log(`    "${offer.message}"`);
  if (offer.parent_offer_id) console.log(`    ${chalk.dim('↳ counter-offer to ' + shortId(offer.parent_offer_id))}`);
  console.log();
}

async function enrichOffer(offer, market) {
  const buyer  = await market.storage.getUserById(offer.buyer_id);
  const seller = await market.storage.getUserById(offer.seller_id);
  return {
    ...offer,
    buyer_id:  buyer  ? buyer.name  : offer.buyer_id,
    seller_id: seller ? seller.name : offer.seller_id,
  };
}

function printMatch(match) {
  if (match.item) {
    console.log(`  ${chalk.yellow('⚡')} Match: "${match.item.title}" at ${formatPrice(match.item.asking_price)} (score: ${match.score})`);
    console.log(`    Item ID: ${chalk.dim(shortId(match.item_id))}  Seller: ${match.item.seller_id}`);
  } else if (match.want) {
    console.log(`  ${chalk.yellow('⚡')} Match: Want by ${match.want.buyer_id} — "${match.want.description}" (score: ${match.score})`);
    console.log(`    Want ID: ${chalk.dim(shortId(match.want_id))}  Budget: ${match.want.max_price ? formatPrice(match.want.max_price) : 'any'}`);
  }
  console.log();
}

function printUser(user) {
  console.log(`  Name:     ${chalk.bold(user.name)}`);
  console.log(`  ID:       ${chalk.dim(user.id)}`);
  if (user.location) console.log(`  Location: ${user.location}`);
  if (user.contact)  console.log(`  Contact:  ${user.contact}`);
  console.log(`  Joined:   ${new Date(user.created_at).toLocaleDateString()}`);
}

async function withMarket(fn) {
  const storage  = new SQLiteAdapter(process.env.AGENTMARKET_DB || 'agentmarket.db');
  const provider = await createEmbeddingProvider();
  const engine   = provider
    ? new MatchingEngine(storage, new SemanticMatcher(provider, storage))
    : undefined; // Market defaults to ExactMatcher
  const market = new Market(storage, engine);
  await market.initialize();
  new WebhookDispatcher(storage).attach(market);
  try {
    await fn(market);
  } catch (err) {
    console.error(chalk.red(`Error: ${err.message}`));
    process.exit(1);
  } finally {
    await market.close();
  }
}

// Resolves token → user, throws if invalid
async function requireAuth(market, token) {
  const user = await market.storage.getUserByToken(token);
  if (!user) throw new Error('Invalid token. Use "agentmarket register" to create an account.');
  return user;
}

// ─── CLI Program ───

const program = new Command();

program
  .name('agentmarket')
  .description('Agent-native secondhand marketplace')
  .version('0.1.0');

// ── register ──
program
  .command('register')
  .description('Create a new user account and receive your token')
  .requiredOption('-n, --name <name>', 'Your display name')
  .option('-l, --location <location>', 'Your location (city/district)')
  .option('-c, --contact <contact>', 'Contact info (email or phone)')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const now = new Date().toISOString();
      const user = {
        id: uuid(),
        token: uuid(),
        name: opts.name,
        location: opts.location || null,
        contact: opts.contact || null,
        created_at: now,
      };
      await market.storage.saveUser(user);

      console.log(chalk.green('\n✓ Account created!\n'));
      printUser(user);
      console.log();
      console.log(chalk.bold('  Your token (keep this secret):'));
      console.log(`  ${chalk.cyan(user.token)}`);
      console.log();
      console.log(chalk.dim('  Use --token <token> in all subsequent commands.'));
      console.log();
    });
  });

// ── whoami ──
program
  .command('whoami')
  .description('Show your profile')
  .requiredOption('--token <token>', 'Your auth token')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);
      console.log(chalk.bold('\n  Your profile:\n'));
      printUser(user);
      console.log();
    });
  });

// ── list ──
program
  .command('list')
  .description('List an item for sale')
  .requiredOption('--token <token>', 'Your auth token')
  .requiredOption('-t, --title <title>', 'Item title')
  .requiredOption('-c, --category <cat>', `Category (${Categories.join(', ')})`)
  .requiredOption('-p, --price <price>', 'Asking price', parseFloat)
  .option('-d, --description <desc>', 'Item description')
  .option('--condition <cond>', `Condition (${Object.values(Condition).join(', ')})`, 'good')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);
      const { item, matches } = await market.listItem({
        sellerId: user.id,
        title: opts.title,
        description: opts.description,
        category: opts.category,
        askingPrice: opts.price,
        condition: opts.condition,
      });

      console.log(chalk.green('\n✓ Item listed successfully\n'));
      printItem({ ...item, seller_id: user.name });

      if (matches.length > 0) {
        console.log(chalk.yellow(`  Found ${matches.length} matching want(s):\n`));
        matches.forEach(printMatch);
      }
    });
  });

// ── search ──
program
  .command('search')
  .description('Search for listed items')
  .option('-c, --category <cat>', 'Filter by category')
  .option('-p, --max-price <price>', 'Maximum price', parseFloat)
  .option('--min-condition <cond>', 'Minimum condition')
  .option('-k, --keyword <kw>', 'Keyword search')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const items = await market.search({
        category: opts.category,
        maxPrice: opts.maxPrice,
        minCondition: opts.minCondition,
        keyword: opts.keyword,
      });

      if (items.length === 0) {
        console.log(chalk.dim('\n  No items found matching your criteria.\n'));
        return;
      }

      // Enrich seller_id → name
      const sellerCache = {};
      for (const item of items) {
        if (!sellerCache[item.seller_id]) {
          const seller = await market.storage.getUserById(item.seller_id);
          sellerCache[item.seller_id] = seller ? seller.name : item.seller_id;
        }
        item.seller_id = sellerCache[item.seller_id];
      }

      console.log(chalk.bold(`\n  Found ${items.length} item(s):\n`));
      items.forEach(printItem);
    });
  });

// ── want ──
program
  .command('want')
  .description('Create a buy request (want)')
  .requiredOption('--token <token>', 'Your auth token')
  .requiredOption('-d, --description <desc>', 'What you want')
  .option('-c, --category <cat>', 'Preferred category')
  .option('-p, --max-price <price>', 'Maximum budget', parseFloat)
  .option('--min-condition <cond>', 'Minimum acceptable condition', 'fair')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);
      const { want, matches } = await market.createWant({
        buyerId: user.id,
        description: opts.description,
        category: opts.category,
        maxPrice: opts.maxPrice,
        minCondition: opts.minCondition,
      });

      console.log(chalk.green('\n✓ Want created successfully\n'));
      console.log(`  ID: ${chalk.dim(shortId(want.id))}  Buyer: ${user.name}`);
      console.log(`  "${want.description}"`);
      if (want.max_price) console.log(`  Budget: ${formatPrice(want.max_price)}`);
      console.log();

      if (matches.length > 0) {
        console.log(chalk.yellow(`  Found ${matches.length} matching item(s):\n`));
        matches.forEach(printMatch);
      }
    });
  });

// ── offer ──
program
  .command('offer')
  .description('Make an offer on an item')
  .requiredOption('--token <token>', 'Your auth token')
  .requiredOption('-i, --item <id>', 'Item ID (first 8 chars ok)')
  .requiredOption('-a, --amount <price>', 'Offer amount', parseFloat)
  .option('-m, --message <msg>', 'Message to seller')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);

      let itemId = opts.item;
      if (itemId.length < 36) {
        const allItems = await market.search({});
        const found = allItems.find(i => i.id.startsWith(itemId));
        if (!found) throw new Error(`No item found starting with "${itemId}"`);
        itemId = found.id;
      }

      const { offer, item } = await market.makeOffer({
        buyerId: user.id,
        itemId,
        amount: opts.amount,
        message: opts.message,
      });

      console.log(chalk.green('\n✓ Offer submitted\n'));
      printOffer(await enrichOffer(offer, market));
      console.log(chalk.dim(`  Item "${item.title}" is now reserved.\n`));
    });
  });

// ── respond ──
program
  .command('respond')
  .description('Respond to an offer (accept/reject/counter)')
  .requiredOption('--token <token>', 'Your auth token')
  .requiredOption('-o, --offer <id>', 'Offer ID (first 8 chars ok)')
  .requiredOption('-a, --action <action>', 'Action: accept, reject, counter')
  .option('--counter-amount <price>', 'Counter-offer amount', parseFloat)
  .option('-m, --message <msg>', 'Message to buyer')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);

      let offerId = opts.offer;
      if (offerId.length < 36) {
        const { asSeller } = await market.myOffers(user.id);
        const found = asSeller.find(o => o.id.startsWith(offerId));
        if (!found) throw new Error(`No offer found starting with "${offerId}"`);
        offerId = found.id;
      }

      const result = await market.respondOffer({
        offerId,
        sellerId: user.id,
        action: opts.action,
        counterAmount: opts.counterAmount,
        message: opts.message,
      });

      if (result.status === 'accepted') {
        console.log(chalk.green('\n✓ Offer accepted!\n'));
        printOffer(await enrichOffer(result.offer, market));
      } else if (result.status === 'rejected') {
        console.log(chalk.red('\n✗ Offer rejected. Item re-listed.\n'));
      } else if (result.status === 'countered') {
        console.log(chalk.magenta('\n↔ Counter-offer sent\n'));
        printOffer(await enrichOffer(result.offer, market));
      }
    });
  });

// ── respond-counter ──
program
  .command('respond-counter')
  .description('Buyer responds to a counter-offer')
  .requiredOption('--token <token>', 'Your auth token')
  .requiredOption('-o, --offer <id>', 'Counter-offer ID (first 8 chars ok)')
  .requiredOption('-a, --action <action>', 'Action: accept, reject')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);

      let offerId = opts.offer;
      if (offerId.length < 36) {
        const { asBuyer } = await market.myOffers(user.id);
        const found = asBuyer.find(o => o.id.startsWith(offerId));
        if (!found) throw new Error(`No offer found starting with "${offerId}"`);
        offerId = found.id;
      }

      const result = await market.respondToCounter({
        offerId,
        buyerId: user.id,
        action: opts.action,
      });

      if (result.status === 'accepted') {
        console.log(chalk.green('\n✓ Counter-offer accepted!\n'));
        printOffer(await enrichOffer(result.offer, market));
      } else {
        console.log(chalk.red('\n✗ Counter-offer rejected. Item re-listed.\n'));
      }
    });
  });

// ── settle ──
program
  .command('settle')
  .description('Settle an accepted offer (finalize transaction)')
  .requiredOption('--token <token>', 'Your auth token')
  .requiredOption('-o, --offer <id>', 'Accepted offer ID')
  .action(async (opts) => {
    await withMarket(async (market) => {
      await requireAuth(market, opts.token);

      let offerId = opts.offer;
      if (offerId.length < 36) {
        const storage = market.storage;
        const allOffers = storage.db.prepare('SELECT id FROM offers WHERE id LIKE ?').all(`${offerId}%`);
        if (allOffers.length === 0) throw new Error(`No offer found starting with "${offerId}"`);
        offerId = allOffers[0].id;
      }

      const result = await market.settle(offerId);

      const seller = await market.storage.getUserById(result.offer.seller_id);
      const buyer  = await market.storage.getUserById(result.offer.buyer_id);

      console.log(chalk.cyan('\n✓ Transaction settled!\n'));
      console.log(`  Item:        ${result.item.title}`);
      console.log(`  Final price: ${formatPrice(result.offer.amount)}`);
      console.log();
      console.log(chalk.bold('  Seller:'));
      if (seller) {
        console.log(`    ${seller.name}${seller.location ? '  (' + seller.location + ')' : ''}`);
        if (seller.contact) console.log(`    Contact: ${chalk.cyan(seller.contact)}`);
      }
      console.log(chalk.bold('  Buyer:'));
      if (buyer) {
        console.log(`    ${buyer.name}${buyer.location ? '  (' + buyer.location + ')' : ''}`);
        if (buyer.contact) console.log(`    Contact: ${chalk.cyan(buyer.contact)}`);
      }
      console.log();
    });
  });

// ── my-listings ──
program
  .command('my-listings')
  .description('View your listed items')
  .requiredOption('--token <token>', 'Your auth token')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);
      const items = await market.myListings(user.id);
      if (items.length === 0) {
        console.log(chalk.dim('\n  No listings found.\n'));
        return;
      }
      console.log(chalk.bold(`\n  ${user.name}'s listings (${items.length}):\n`));
      items.forEach(i => printItem({ ...i, seller_id: user.name }));
    });
  });

// ── my-offers ──
program
  .command('my-offers')
  .description('View your offers (as buyer and seller)')
  .requiredOption('--token <token>', 'Your auth token')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);
      const { asBuyer, asSeller } = await market.myOffers(user.id);

      if (asBuyer.length === 0 && asSeller.length === 0) {
        console.log(chalk.dim('\n  No offers found.\n'));
        return;
      }

      if (asBuyer.length > 0) {
        console.log(chalk.bold(`\n  Offers made (as buyer): ${asBuyer.length}\n`));
        for (const o of asBuyer) printOffer(await enrichOffer(o, market));
      }
      if (asSeller.length > 0) {
        console.log(chalk.bold(`\n  Offers received (as seller): ${asSeller.length}\n`));
        for (const o of asSeller) printOffer(await enrichOffer(o, market));
      }
    });
  });

// ── my-wants ──
program
  .command('my-wants')
  .description('View your active wants')
  .requiredOption('--token <token>', 'Your auth token')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);
      const wants = await market.myWants(user.id);
      if (wants.length === 0) {
        console.log(chalk.dim('\n  No wants found.\n'));
        return;
      }
      console.log(chalk.bold(`\n  ${user.name}'s wants (${wants.length}):\n`));
      wants.forEach(w => {
        console.log(`  ${chalk.dim(shortId(w.id))} "${w.description}" ${statusBadge(w.status)}`);
        if (w.max_price) console.log(`    Budget: ${formatPrice(w.max_price)}  Category: ${w.category || 'any'}`);
        console.log();
      });
    });
  });

// ── suggest-price ──
program
  .command('suggest-price')
  .description('Get an AI-powered price suggestion for an item (requires AGENTMARKET_LLM)')
  .requiredOption('-t, --title <title>', 'Item title')
  .requiredOption('-c, --category <cat>', 'Item category')
  .requiredOption('--condition <cond>', 'Item condition')
  .option('-d, --description <desc>', 'Item description')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const llm = await createLLMProvider();
      if (!llm) {
        console.error(chalk.red(
          'Error: No LLM provider configured.\n' +
          'Set AGENTMARKET_LLM=anthropic (with ANTHROPIC_API_KEY)\n' +
          '   or AGENTMARKET_LLM=openai   (with OPENAI_API_KEY)',
        ));
        process.exit(1);
      }

      console.log(chalk.dim('\n  Consulting market data and AI...\n'));

      const result = await suggestPrice(
        {
          title:       opts.title,
          category:    opts.category,
          condition:   opts.condition,
          description: opts.description,
        },
        market.storage,
        llm,
      );

      console.log(chalk.bold('  Price Suggestion\n'));
      console.log(`  Suggested:  ${chalk.green(formatPrice(result.suggested_price))}`);
      console.log(`  Range:      ${formatPrice(result.range.min)} – ${formatPrice(result.range.max)}`);
      console.log(`\n  ${chalk.dim(result.reasoning)}\n`);
    });
  });

// ── webhook-set ──
program
  .command('webhook-set')
  .description('Register or update your webhook endpoint')
  .requiredOption('--token <token>', 'Your auth token')
  .requiredOption('-u, --url <url>', 'HTTPS endpoint to receive events')
  .option('-e, --events <events>', 'Comma-separated events to subscribe (default: all)', '')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user   = await requireAuth(market, opts.token);
      const secret = uuid(); // generate signing secret
      const events = opts.events
        ? JSON.stringify(opts.events.split(',').map(e => e.trim()).filter(Boolean))
        : '[]';

      await market.storage.saveWebhook({
        id:         uuid(),
        user_id:    user.id,
        url:        opts.url,
        secret,
        events,
        created_at: new Date().toISOString(),
      });

      console.log(chalk.green('\n✓ Webhook registered\n'));
      console.log(`  URL:     ${opts.url}`);
      console.log(`  Events:  ${events === '[]' ? 'all' : opts.events}`);
      console.log(`\n  ${chalk.bold('Signing secret (save this to verify incoming requests):')}`);
      console.log(`  ${chalk.cyan(secret)}\n`);
    });
  });

// ── webhook-remove ──
program
  .command('webhook-remove')
  .description('Remove your webhook endpoint')
  .requiredOption('--token <token>', 'Your auth token')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user = await requireAuth(market, opts.token);
      await market.storage.deleteWebhookByUser(user.id);
      console.log(chalk.green('\n✓ Webhook removed\n'));
    });
  });

// ── webhook-info ──
program
  .command('webhook-info')
  .description('Show your webhook status and recent deliveries')
  .requiredOption('--token <token>', 'Your auth token')
  .action(async (opts) => {
    await withMarket(async (market) => {
      const user    = await requireAuth(market, opts.token);
      const webhook = await market.storage.getWebhookByUser(user.id);

      if (!webhook) {
        console.log(chalk.dim('\n  No webhook registered. Use webhook-set to add one.\n'));
        return;
      }

      const events    = JSON.parse(webhook.events);
      const deliveries = await market.storage.getWebhookDeliveries(webhook.id, 10);

      console.log(chalk.bold('\n  Webhook\n'));
      console.log(`  URL:    ${webhook.url}`);
      console.log(`  Events: ${events.length === 0 ? 'all' : events.join(', ')}`);

      if (deliveries.length > 0) {
        console.log(chalk.bold('\n  Recent deliveries:\n'));
        deliveries.forEach(d => {
          const icon   = d.success ? chalk.green('✓') : chalk.red('✗');
          const status = d.status_code > 0 ? `HTTP ${d.status_code}` : 'timeout/error';
          console.log(`  ${icon}  ${d.event.padEnd(22)} ${status}  ${chalk.dim(d.delivered_at)}`);
        });
      } else {
        console.log(chalk.dim('\n  No deliveries yet.'));
      }
      console.log();
    });
  });

program.parse();
