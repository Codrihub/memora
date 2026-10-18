// robots.txt for a private instance: no crawler, search engine or AI scraper
// may index any page. Every response also carries X-Robots-Tag: noindex.
// Rendered by scripts/build-pages.mjs into crates/http/assets/robots.txt.

const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'CCBot',
  'Google-Extended',
  'PerplexityBot',
  'Bytespider',
  'Amazonbot',
  'Applebot-Extended',
  'meta-externalagent',
  'cohere-ai',
  'Diffbot',
  'ImagesiftBot',
];

export function robotsTxt(): string {
  const ai = AI_CRAWLERS.map((ua) => `User-agent: ${ua}\nDisallow: /\n`).join('\n');
  return `User-agent: *\nDisallow: /\n\n${ai}`;
}
