/**
 * OpenAI LLM Provider
 *
 * Setup:
 *   npm install openai
 *   export AGENTMARKET_LLM=openai
 *   export OPENAI_API_KEY=sk-...
 *   (optional) export AGENTMARKET_LLM_MODEL=gpt-4o-mini
 */

import { LLMProvider } from './provider.js';

export class OpenAILLMProvider extends LLMProvider {
  constructor({
    apiKey = process.env.OPENAI_API_KEY,
    model  = process.env.AGENTMARKET_LLM_MODEL || 'gpt-4o-mini',
  } = {}) {
    super();
    if (!apiKey) throw new Error('OpenAI API key is required (OPENAI_API_KEY)');
    this._apiKey = apiKey;
    this._model  = model;
  }

  get modelName() { return this._model; }

  async complete(messages) {
    const { OpenAI } = await import('openai');
    if (!this._client) this._client = new OpenAI({ apiKey: this._apiKey });

    const res = await this._client.chat.completions.create({
      model:    this._model,
      messages,
    });

    return res.choices[0].message.content;
  }
}
