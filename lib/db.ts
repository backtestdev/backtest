import { neon } from "@neondatabase/serverless";

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }
  return neon(databaseUrl);
}

export function generateParametersHash(params: unknown): string {
  // Create a deterministic string from sorted JSON
  const sortedJson = JSON.stringify(params, Object.keys(params as Record<string, unknown>).sort());
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < sortedJson.length; i++) {
    const char = sortedJson.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}
