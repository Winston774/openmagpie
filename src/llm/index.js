/**
 * LLM Provider Factory
 *
 * Reads AGENTMARKET_LLM env var and returns the appropriate provider.
 * Returns null if not configured → LLM features unavailable, everything else still works.
 *
 * Supported values:
 *   AGENTMARKET_LLM=anthropic  (requires ANTHROPIC_API_KEY)
 *   AGENTMARKET_LLM=openai     (requires OPENAI_API_KEY, npm install openai)
 *   (unset)                    → null, LLM features disabled gracefully
 */

export async function createLLMProvider() {
  const backend = process.env.AGENTMARKET_LLM?.toLowerCase();

  if (!backend) return null;

  if (backend === 'anthropic') {
    const { AnthropicProvider } = await import('./anthropic.js');
    return new AnthropicProvider();
  }

  if (backend === 'openai') {
    const { OpenAILLMProvider } = await import('./openai.js');
    return new OpenAILLMProvider();
  }

  throw new Error(
    `Unknown LLM provider: "${backend}". Valid options: anthropic, openai`,
  );
}
