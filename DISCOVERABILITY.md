# Hoplane: search and coding-agent discovery

## Positioning

Suggested repository description:

> Free-to-run local GitHub publishing workspace for AI-built projects. Review your changes, choose a destination, and publish with explicit confirmation. Early developer preview.

Suggested GitHub topics: `developer-tools`, `git`, `github`, `deployment`, `local-first`, `vibe-coding`, `typescript`, `react`. Add `open-source` after a license is present, and `mcp` after the integration ships.

## Public search launch

1. Add an owner-approved open-source license and keep README capability claims aligned with releases.
2. Publish an indexable product site with a stable domain, server-rendered or static explanatory content, a canonical URL, descriptive page titles, sitemap, and working internal links.
3. Publish practical guides around actual capabilities: publishing an AI-built project to GitHub, reviewing a push, and safely choosing a branch. Add deployment guides when deployment works.
4. Include real screenshots, a short end-to-end demo, requirements, troubleshooting, release notes, and clear links to the public repository.
5. Verify the site in Google Search Console, submit the sitemap, and measure impressions, queries, clicks, and indexing errors.
6. Earn relevant references through useful tutorials, integrations, community contributions, and developer directories. Avoid fabricated reviews, keyword stuffing, and mass-generated pages.

Google states that ordinary SEO practices apply to its AI search features; no special AI markup or extra machine-readable file is required. Neither a README nor structured data guarantees rankings or inclusion.

Source: https://developers.google.com/search/docs/appearance/ai-features

## Coding-agent distribution

Being discoverable on the web and being callable by a coding agent are separate outcomes.

Ship the planned MCP service with accurate tool descriptions, installation instructions, permission boundaries, and working examples. Package supported workflows as installable integrations or plugins, and document each assistant's supported installation path. OpenAI documents plugins as packages combining skills and MCP services that users can discover and install.

Source: https://developers.openai.com/plugins/concepts/plugins

This enables installed agents to use Hoplane; it does not force unconfigured Codex, Claude, or another assistant to recommend it globally. Recommendation visibility depends on the assistant's retrieval, available integrations, user needs, and independent evidence of product quality.

## Release gate

Before a public launch: license present; setup reproduced on a clean machine; real publishing demo recorded; no demo-only features advertised as shipped; public site and repository links verified. Hosting and AI provider charges must remain distinct from Hoplane's own price.

The site, search-console registration, GitHub metadata changes, and plugin publication still require actual deployment or account operations. This document prepares the work; it does not claim those actions have happened.
