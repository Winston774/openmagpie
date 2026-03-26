/**
 * Anthropic (Claude) LLM Provider
 *
 * Setup:
 *   export AGENTMARKET_LLM=anthropic
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   (optional) export AGENTMARKET_LLM_MODEL=claude-haiku-4-5-20251001
 */

import { LLMProvider } from './provider.js';

export class AnthropicProvider extends LLMProvider {
  constructor({
    apiKey = process.env.ANTHROPIC_API_KEY,
    model  = process.env.AGENTMARKET_LLM_MODEL || 'claude-haiku-4-5-20251001',
  } = {}) {
    super();
    if (!apiKey) throw new Error('Anthropic API key is required (ANTHROPIC_API_KEY)');
    this._apiKey = apiKey;
    this._model  = model;
  }

  get modelName() { return this._model; }

  async complete(messages) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    if (!this._client) this._client = new Anthropic({ apiKey: this._apiKey });

    // Separate system message if present
    const system  = messages.find(m => m.role === 'system')?.content;
    const history = messages.filter(m => m.role !== 'system');

    const res = await this._client.messages.create({
      model:      this._model,
      max_tokens: 1024,
      ...(system ? { system } : {}),
      messages:   history,
    });

    return res.content[0].text;
  }
}
