/**
 * Embedding Provider Factory
 *
 * Reads AGENTMARKET_EMBEDDING env var and returns the appropriate provider.
 * Returns null if not configured → caller falls back to ExactMatcher.
 *
 * Supported values:
 *   AGENTMARKET_EMBEDDING=openai   (requires OPENAI_API_KEY)
 *   AGENTMARKET_EMBEDDING=ollama   (requires Ollama running locally)
 *   (unset)                        → ExactMatcher fallback, no embedding
 */

export async function createEmbeddingProvider() {
  const backend = process.env.AGENTMARKET_EMBEDDING?.toLowerCase();

  if (!backend) return null;

  if (backend === 'openai') {
    const { OpenAIEmbeddingProvider } = await import('./openai.js');
    return new OpenAIEmbeddingProvider();
  }

  if (backend === 'ollama') {
    const { OllamaEmbeddingProvider } = await import('./ollama.js');
    return new OllamaEmbeddingProvider();
  }

  throw new Error(
    `Unknown embedding provider: "${backend}". Valid options: openai, ollama`,
  );
}
