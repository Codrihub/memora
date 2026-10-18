// robots.txt for a private instance: keep crawlers out of the vault UI.
// Rendered by scripts/build-pages.mjs into crates/http/assets/robots.txt.

export function robotsTxt(): string {
  return `User-agent: *
Disallow: /api/
Disallow: /mcp
Disallow: /_bus
Disallow: /ws
Disallow: /login
Disallow: /logout
`;
}
