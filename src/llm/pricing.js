/**
 * AgentMarket — Price Suggestion
 *
 * Uses LLMProvider + real market data from the DB to suggest a fair price.
 * Market context (similar listings, recent sales) is injected into the prompt
 * so the LLM reasons from actual data, not just general knowledge.
 *
 * Returns null gracefully if no LLMProvider is configured.
 */

/**
 * @param {object} item  - { title, description, category, condition }
 * @param {import('../storage/adapter.js').StorageAdapter} storage
 * @param {import('./provider.js').LLMProvider|null} llm
 * @returns {Promise<{suggested_price: number, range: {min:number, max:number}, reasoning: string}|null>}
 */
export async function suggestPrice(item, storage, llm) {
  if (!llm) return null;

  // ── Gather market context from DB ──

  const similarListings = await storage.searchItems({
    category: item.category,
    status:   'listed',
  });

  const recentSales = await storage.getRecentSales({
    category: item.category,
    limit:    10,
  });

  // ── Build prompt ──

  const marketSection = buildMarketSection(similarListings, recentSales);

  const messages = [
    {
      role: 'system',
      content:
        'You are a pricing expert for a secondhand marketplace. ' +
        'Respond ONLY with a JSON object — no markdown, no explanation outside the JSON.',
    },
    {
      role: 'user',
      content: `Suggest a fair asking price for this secondhand item.

ITEM
----
Title:       ${item.title}
Category:    ${item.category}
Condition:   ${item.condition}
Description: ${item.description || '(none)'}

${marketSection}

Reply with this exact JSON structure:
{
  "suggested_price": <number>,
  "range": { "min": <number>, "max": <number> },
  "reasoning": "<one or two sentences explaining the price>"
}`,
    },
  ];

  const raw = await llm.complete(messages);

  return parseJSON(raw);
}

// ── Helpers ──

function buildMarketSection(listings, sales) {
  const lines = [];

  if (listings.length > 0) {
    lines.push('SIMILAR ITEMS CURRENTLY LISTED');
    lines.push('-------------------------------');
    listings.slice(0, 8).forEach(i => {
      lines.push(`• ${i.title} — ${i.condition} — $${i.asking_price}`);
    });
    lines.push('');
  }

  if (sales.length > 0) {
    lines.push('RECENT SALES (same category)');
    lines.push('-----------------------------');
    sales.forEach(s => {
      lines.push(`• ${s.title} — ${s.condition} — sold for $${s.final_price}`);
    });
    lines.push('');
  }

  if (lines.length === 0) {
    lines.push('MARKET DATA: No comparable data available yet in this marketplace.');
  }

  return lines.join('\n');
}

function parseJSON(raw) {
  try {
    // Strip accidental markdown code fences if any
    const clean = raw.replace(/```(?:json)?/g, '').trim();
    return JSON.parse(clean);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${raw}`);
  }
}
