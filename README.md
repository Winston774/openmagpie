# AgentMarket

An agent-native secondhand marketplace protocol & CLI. Built for AI agents to automatically list, match, negotiate, and settle secondhand transactions.

## Quick Start

```bash
npm install
node src/demo.js          # Run the full demo
node src/cli.js --help    # See all commands
```

## Demo

The demo simulates two agents completing a full transaction:

```bash
node src/demo.js
```

This runs: Alice lists a MacBook → Bob creates a "want" → System auto-matches → Bob offers → Alice counters → Bob accepts → Transaction settles.

## CLI Commands

### List an item

```bash
node src/cli.js list \
  --seller alice \
  --title "MacBook Pro 2022 M2" \
  --category computers \
  --price 28000 \
  --condition like_new \
  --description "16GB RAM, 512GB SSD"
```

### Search for items

```bash
node src/cli.js search --category computers --max-price 30000
node src/cli.js search --keyword "MacBook"
```

### Create a "want" (buy request)

```bash
node src/cli.js want \
  --buyer bob \
  --description "MacBook Pro laptop good condition" \
  --category computers \
  --max-price 30000
```

When a want is created, the matching engine automatically checks all listed items. When a new item is listed, it checks all active wants. Matches are instant.

### Make an offer

```bash
node src/cli.js offer --buyer bob --item <item-id> --amount 25000
```

Item IDs support short prefixes (first 8 characters).

### Respond to an offer

```bash
# Accept
node src/cli.js respond --seller alice --offer <offer-id> --action accept

# Reject (item goes back to "listed")
node src/cli.js respond --seller alice --offer <offer-id> --action reject

# Counter-offer
node src/cli.js respond --seller alice --offer <offer-id> --action counter --counter-amount 27000
```

### Buyer responds to counter-offer

```bash
node src/cli.js respond-counter --buyer bob --offer <counter-id> --action accept
```

### Settle a transaction

```bash
node src/cli.js settle --offer <accepted-offer-id>
```

### View your data

```bash
node src/cli.js my-listings --seller alice
node src/cli.js my-offers --user alice
node src/cli.js my-wants --buyer bob
```

## Architecture

```
┌─────────────────────────────────────────────┐
│          Interface Adapters (pluggable)      │
│   ┌─────────┐  ┌───────────┐  ┌──────────┐ │
│   │   CLI   │  │MCP Server │  │ REST API │ │
│   └────┬────┘  └─────┬─────┘  └────┬─────┘ │
│        └──────────┬──┘──────────────┘       │
│   ┌───────────────┴───────────────────┐     │
│   │         Core Protocol             │     │
│   │  list · search · offer · settle   │     │
│   │  JSON Schema · State Machine      │     │
│   └───────────────┬───────────────────┘     │
│   ┌───────────────┴───────────────────┐     │
│   │       Matching Engine             │     │
│   │  Pluggable: exact / fuzzy / LLM   │     │
│   └───────────────┬───────────────────┘     │
│   ┌───────────────┴───────────────────┐     │
│   │     Storage Adapters (pluggable)  │     │
│   │  SQLite │ PostgreSQL │ Custom     │     │
│   └───────────────────────────────────┘     │
└─────────────────────────────────────────────┘
```

## Extending the Framework

### Custom Storage Adapter

```js
import { StorageAdapter } from './src/storage/adapter.js';

class MyCloudAdapter extends StorageAdapter {
  async saveItem(item) { /* your implementation */ }
  async getItem(id) { /* your implementation */ }
  // ... implement all methods
}
```

### Custom Matching Strategy

```js
import { MatchingStrategy } from './src/core/matching.js';

class SemanticMatcher extends MatchingStrategy {
  score(item, want) {
    // Use embeddings, LLM calls, etc.
    return similarityScore;
  }
}
```

### Event Hooks

```js
market.on('matches_found', ({ item, matches }) => {
  // Send push notification, webhook, etc.
});

market.on('offer_accepted', ({ offer }) => {
  // Trigger payment flow
});

market.on('transaction_settled', ({ offer, item }) => {
  // Update inventory, send confirmation
});
```

## Transaction State Machine

```
LISTED → (match) → OFFERED → NEGOTIATING ←→ (counter loop)
                                    ↓
                               ACCEPTED → SETTLED
                                    ↓
                               REJECTED → re-LISTED
```

## Environment Variables

- `AGENTMARKET_DB` — Path to SQLite database file (default: `agentmarket.db`)

## Next Steps

- [ ] MCP Server interface (Step 2)
- [ ] Semantic matching with embeddings
- [ ] Price suggestion via LLM
- [ ] Webhook notifications
- [ ] Multi-user authentication
- [ ] npm package for framework distribution

## License

MIT
