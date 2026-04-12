# ADR-004: React + Vite Over Next.js for Web App Frontend

**Status:** Accepted
**Date:** 2026-04-12

## Context

The web app dashboard requires a modern frontend framework. The two primary candidates are React + Vite (a pure client-side SPA) and Next.js (React with server-side rendering, file-based routing, and built-in API routes). The app is deployed to Cloudflare Pages and talks to an existing FastAPI backend.

## Decision

Use React + Vite to build a pure client-side SPA deployed as static files to Cloudflare Pages.

## Alternatives Considered

**Next.js:** React framework with SSR, file-based routing, image optimization, and built-in API routes. Widely used in production. Cloudflare Pages supports Next.js via the `@cloudflare/next-on-pages` adapter, but the adapter has known limitations around edge runtime compatibility and requires additional configuration. The primary Next.js advantages — SSR for SEO and API routes — are not relevant for an authenticated dashboard (SEO does not apply behind auth; API routes are replaced by FastAPI).

**Vue / Svelte:** Alternative frameworks with comparable capability. Rejected in favor of React due to ecosystem size, shadcn/ui availability, and developer familiarity.

**Vanilla TypeScript (current extension pattern):** The extension pages use plain HTML + TypeScript compiled by webpack. This pattern works for the extension because each page is small and self-contained. A full dashboard with multiple routes, shared state, and a component library would become unwieldy without a component model.

## Consequences

**Positive:**
- Cloudflare Pages deploys React + Vite with zero configuration — build output is pure static HTML/JS/CSS.
- No adapter layer, no edge runtime constraints, no framework-specific deployment quirks.
- React's component model is appropriate for a multi-route dashboard with shared UI elements (tables, score rings, status pills).
- shadcn/ui provides production-quality components built on Radix UI primitives — accessible, themeable, and compatible with Tailwind CSS.
- React Query (`@tanstack/react-query`) handles server state (loading, caching, background refetch) without a global state library.
- Vite's dev server provides near-instant HMR for a fast development loop.

**Negative:**
- No SSR — the initial page load renders a loading state before data fetches resolve. Acceptable for an authenticated tool where SEO is irrelevant and the user expects a small delay.
- Client-side routing requires configuring Cloudflare Pages to serve `index.html` for all routes (standard SPA redirect rule — one line of configuration).
- No built-in API routes; all data fetching goes through FastAPI. This is not a limitation since FastAPI is the intentional backend.

**If Next.js becomes necessary:**
Migration from React + Vite to Next.js is a well-trodden path. Components, hooks, and API client code are reusable. The main migration cost is adopting Next.js routing conventions and configuring the Cloudflare adapter.
