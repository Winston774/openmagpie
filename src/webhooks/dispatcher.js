/**
 * AgentMarket — Webhook Dispatcher
 *
 * Listens to Market events and delivers signed HTTP POST payloads
 * to each user's registered webhook URL.
 *
 * Security: every request is signed with HMAC-SHA256 using the user's
 * webhook secret. Recipients should verify the signature before processing.
 *
 * Signature header: X-AgentMarket-Signature: sha256=<hex>
 * Verification example:
 *   const expected = 'sha256=' + hmac(secret, rawBody);
 *   if (expected !== req.headers['x-agentmarket-signature']) reject();
 */

import { createHmac } from 'crypto';

export class WebhookDispatcher {
  constructor(storage) {
    this.storage = storage;
  }

  /**
   * Attach to a Market instance — call this once after market.initialize().
   * @param {import('../core/market.js').Market} market
   */
  attach(market) {
    market.on('matches_found', async ({ item, want, matches }) => {
      // item listed → notify seller; want created → notify buyer
      if (item)  await this._dispatch('matches_found', { item, matches },  [item.seller_id]);
      if (want)  await this._dispatch('matches_found', { want, matches },  [want.buyer_id]);
    });

    market.on('offer_made', async ({ offer, item }) => {
      await this._dispatch('offer_made', { offer, item }, [offer.seller_id]);
    });

    market.on('offer_accepted', async ({ offer }) => {
      await this._dispatch('offer_accepted', { offer }, [offer.buyer_id]);
    });

    market.on('offer_rejected', async ({ offer }) => {
      await this._dispatch('offer_rejected', { offer }, [offer.buyer_id]);
    });

    market.on('offer_countered', async ({ offer, original }) => {
      // Seller countered → notify buyer
      await this._dispatch('offer_countered', { offer, original }, [offer.buyer_id]);
    });

    market.on('transaction_settled', async ({ offer, item }) => {
      await this._dispatch('transaction_settled', { offer, item }, [
        offer.seller_id,
        offer.buyer_id,
      ]);
    });
  }

  // ── Internal ──

  async _dispatch(event, data, userIds) {
    const unique = [...new Set(userIds)];
    await Promise.allSettled(unique.map(uid => this._deliverToUser(event, data, uid)));
  }

  async _deliverToUser(event, data, userId) {
    const webhook = await this.storage.getWebhookByUser(userId);
    if (!webhook) return;
    if (!this._subscribes(webhook, event)) return;

    const payload = JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
    });

    const signature = 'sha256=' + createHmac('sha256', webhook.secret)
      .update(payload)
      .digest('hex');

    try {
      const res = await fetch(webhook.url, {
        method:  'POST',
        headers: {
          'Content-Type':             'application/json',
          'X-AgentMarket-Event':      event,
          'X-AgentMarket-Signature':  signature,
        },
        body:    payload,
        signal:  AbortSignal.timeout(10_000), // 10s timeout
      });

      await this.storage.logWebhookDelivery({
        webhook_id:  webhook.id,
        event,
        status_code: res.status,
        success:     res.ok ? 1 : 0,
        delivered_at: new Date().toISOString(),
      });
    } catch (err) {
      await this.storage.logWebhookDelivery({
        webhook_id:  webhook.id,
        event,
        status_code: 0,
        success:     0,
        delivered_at: new Date().toISOString(),
      });
    }
  }

  _subscribes(webhook, event) {
    const events = JSON.parse(webhook.events || '[]');
    return events.length === 0 || events.includes(event);
  }
}
