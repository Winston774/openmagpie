#!/usr/bin/env node

/**
 * AgentMarket Demo — Full Transaction Flow
 * 
 * Simulates two agents (alice & bob) going through:
 *   1. Alice lists a MacBook
 *   2. Bob creates a "want" for a cheap laptop
 *   3. System auto-matches them
 *   4. Bob makes an offer
 *   5. Alice counters
 *   6. Bob accepts the counter
 *   7. Transaction settles
 * 
 * Run: node src/demo.js
 */

import chalk from 'chalk';
import { Market } from './core/market.js';
import { SQLiteAdapter } from './storage/sqlite.js';
import { unlinkSync } from 'fs';

const DB_PATH = 'demo.db';

// Clean up previous demo
try { unlinkSync(DB_PATH); } catch {}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function divider(title) {
  console.log(chalk.dim('\n' + '─'.repeat(60)));
  console.log(chalk.bold.cyan(`  STEP: ${title}`));
  console.log(chalk.dim('─'.repeat(60) + '\n'));
}

async function main() {
  const storage = new SQLiteAdapter(DB_PATH);
  const market = new Market(storage);

  // Register event listeners (simulating agent notifications)
  market.on('matches_found', ({ item, want, matches }) => {
    const subject = item ? `item "${item.title}"` : `want "${want.description}"`;
    console.log(chalk.yellow(`  📡 EVENT: ${matches.length} match(es) found for ${subject}`));
    matches.forEach(m => {
      if (m.want) console.log(chalk.yellow(`     → Want by ${m.want.buyer_id}: "${m.want.description}" (score: ${m.score})`));
      if (m.item) console.log(chalk.yellow(`     → Item "${m.item.title}" at $${m.item.asking_price} (score: ${m.score})`));
    });
  });

  market.on('offer_made', ({ offer, item }) => {
    console.log(chalk.yellow(`  📡 EVENT: New offer of $${offer.amount} on "${item.title}" from ${offer.buyer_id}`));
  });

  market.on('offer_countered', ({ offer, original }) => {
    console.log(chalk.yellow(`  📡 EVENT: Counter-offer of $${offer.amount} (was $${original.amount})`));
  });

  market.on('offer_accepted', ({ offer }) => {
    console.log(chalk.yellow(`  📡 EVENT: Offer accepted at $${offer.amount}!`));
  });

  market.on('transaction_settled', ({ offer, item }) => {
    console.log(chalk.yellow(`  📡 EVENT: Transaction settled — "${item.title}" sold for $${offer.amount}`));
  });

  await market.initialize();

  console.log(chalk.bold('\n🏪 AgentMarket Demo — Two-Agent Transaction Flow\n'));

  // ─────────────────────────────────────────────
  divider('1. Alice lists a MacBook Pro');
  // ─────────────────────────────────────────────

  const { item: macbook, matches: listMatches } = await market.listItem({
    sellerId: 'alice',
    title: 'MacBook Pro 2022 M2',
    description: 'Great condition, 16GB RAM, 512GB SSD, Space Gray',
    category: 'computers',
    askingPrice: 28000,
    condition: 'like_new',
  });

  console.log(chalk.green(`  ✓ Alice listed: "${macbook.title}" for $${macbook.asking_price}`));
  console.log(chalk.dim(`    ID: ${macbook.id.slice(0, 8)}`));

  if (listMatches.length === 0) {
    console.log(chalk.dim('    No matching wants yet.'));
  }

  await sleep(500);

  // ─────────────────────────────────────────────
  divider('2. Alice also lists a monitor');
  // ─────────────────────────────────────────────

  const { item: monitor } = await market.listItem({
    sellerId: 'alice',
    title: 'Dell U2723QE 4K Monitor',
    description: '27 inch USB-C monitor, IPS panel',
    category: 'electronics',
    askingPrice: 8000,
    condition: 'good',
  });

  console.log(chalk.green(`  ✓ Alice listed: "${monitor.title}" for $${monitor.asking_price}`));

  await sleep(500);

  // ─────────────────────────────────────────────
  divider('3. Bob creates a "want" for a laptop');
  // ─────────────────────────────────────────────

  console.log(chalk.blue('  🤖 Bob\'s Agent: "I want a MacBook under $30,000"'));
  console.log();

  const { want, matches: wantMatches } = await market.createWant({
    buyerId: 'bob',
    description: 'MacBook Pro laptop good condition',
    category: 'computers',
    maxPrice: 30000,
    minCondition: 'good',
  });

  console.log(chalk.green(`  ✓ Want created: "${want.description}"`));
  console.log(chalk.dim(`    ID: ${want.id.slice(0, 8)}  Budget: $${want.max_price}`));

  if (wantMatches.length > 0) {
    console.log(chalk.green(`\n  🎯 Auto-matched ${wantMatches.length} item(s)!`));
  }

  await sleep(500);

  // ─────────────────────────────────────────────
  divider('4. Bob\'s agent makes an offer (auto, based on match)');
  // ─────────────────────────────────────────────

  console.log(chalk.blue('  🤖 Bob\'s Agent: Offering $25,000 (10% below asking)'));
  console.log();

  const { offer: bobOffer } = await market.makeOffer({
    buyerId: 'bob',
    itemId: macbook.id,
    amount: 25000,
    message: 'Would you take $25,000? Great machine!',
  });

  console.log(chalk.green(`  ✓ Offer submitted: $${bobOffer.amount}`));
  console.log(chalk.dim(`    Offer ID: ${bobOffer.id.slice(0, 8)}`));

  await sleep(500);

  // ─────────────────────────────────────────────
  divider('5. Alice\'s agent counters at $27,000');
  // ─────────────────────────────────────────────

  console.log(chalk.blue('  🤖 Alice\'s Agent: "The lowest I can go is $27,000"'));
  console.log();

  const { offer: counterOffer } = await market.respondOffer({
    offerId: bobOffer.id,
    sellerId: 'alice',
    action: 'counter',
    counterAmount: 27000,
    message: 'It is basically new, $27,000 is fair.',
  });

  console.log(chalk.magenta(`  ↔ Counter-offer: $${counterOffer.amount}`));
  console.log(chalk.dim(`    Counter ID: ${counterOffer.id.slice(0, 8)}`));

  await sleep(500);

  // ─────────────────────────────────────────────
  divider('6. Bob\'s agent accepts the counter');
  // ─────────────────────────────────────────────

  console.log(chalk.blue('  🤖 Bob\'s Agent: "$27,000 is within budget — accepting."'));
  console.log();

  const acceptResult = await market.respondToCounter({
    offerId: counterOffer.id,
    buyerId: 'bob',
    action: 'accept',
  });

  console.log(chalk.green(`  ✓ Deal agreed at $${acceptResult.offer.amount}!`));

  await sleep(500);

  // ─────────────────────────────────────────────
  divider('7. Both confirm → Transaction settles');
  // ─────────────────────────────────────────────

  const settleResult = await market.settle(counterOffer.id);

  console.log(chalk.cyan.bold(`  🎉 TRANSACTION COMPLETE`));
  console.log(`     Item:   ${settleResult.item.title}`);
  console.log(`     Price:  $${settleResult.offer.amount}`);
  console.log(`     Seller: ${settleResult.offer.seller_id} → Buyer: ${settleResult.offer.buyer_id}`);
  console.log(`     Status: ${settleResult.item.status.toUpperCase()}`);

  await sleep(500);

  // ─────────────────────────────────────────────
  divider('Final state: Alice\'s listings');
  // ─────────────────────────────────────────────

  const aliceListings = await market.myListings('alice');
  aliceListings.forEach(item => {
    const status = item.status === 'sold' ? chalk.cyan('SOLD') : chalk.green('LISTED');
    console.log(`  ${status}  "${item.title}" — $${item.asking_price}`);
  });

  console.log();

  await market.close();
  console.log(chalk.dim('  Demo complete. Database saved to: demo.db\n'));
}

main().catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
