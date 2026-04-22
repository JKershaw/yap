# Architecture

How yap is built. For what it does, see [DESIGN.md](./DESIGN.md). For why, see [PHILOSOPHY.md](./PHILOSOPHY.md).

## Principles

- **Fewest dependencies.** Builtins first. A new dependency needs a PR note explaining why a `node:` module or ~20 lines of code won't do.
- **No build step.** Write `.ts`, run `.ts`. Node's type stripping gives us types without a compile stage.
- **Comprehensive tests.** Unit, integration, API/MCP conformance, and e2e in a real browser.
- **Clean, tidy abstractions.** Modules of functions over classes. Function signatures follow the domain, not a dogma.
- **Logical file organisation.** Grouped by concept so the code, its tests, and its purpose sit together.

## Runtime & tooling

- **Node ≥ 22.6 with `--experimental-strip-types`** (or 23+ where it's default). Write `.ts`, run directly. No bundler, no `tsc` build, no `dist/`. `tsc --noEmit` is used in CI for type checking only.
- **ESM only.** `"type": "module"`, `.ts` on disk, Node resolves extensions.
- **One `package.json`, one `bin` (`yap`)** dispatching to sub-commands (`yap cli`, `yap agent`, `yap mcp`) from a single entry file. Workspaces come later, if ever.

## Dependencies

Target: single-digit runtime count.

Runtime:

- `@modelcontextprotocol/sdk` — can't reasonably hand-roll MCP.
- `node:crypto` `scrypt` for password hashing — no bcrypt dep needed.
- Plain `fetch` against OpenRouter for the agent runtime — no LLM SDK.

Everything else from `node:` builtins:

- `node:http` for the server (no Express/Fastify).
- `node:test` + `node:assert` for unit/integration/API tests.
- `node:crypto`, `node:timers/promises`, `node:stream` as needed.

Dev:

- `typescript` (types only, no emit).
- `@playwright/test` for e2e.
- `prettier` (optional).

## Code style

- **Modules of functions, not classes.** No `this`, no inheritance, no constructors hiding state.
- **Signatures follow the model.** `say(store, channel, nick, text)` is fine; don't force a reducer shape just to look functional.
- **One source of truth for state.** A single `store` value created at boot, passed explicitly to handlers. No singletons, no module-level mutables, no DI container.
- **Pure where it's free.** `parseMentions`, `classifyPresence`, `hashPassword`, id allocation have no reason to touch I/O, so they don't. Elsewhere, mutate a `Map` when mutation is the obvious move.
- **Small files, named for the concept.** If you can't describe a file in four words, split it.

## File layout

Grouped by domain concept. HTTP and MCP are separate folders because they are genuinely distinct surfaces over the same handlers.

    /src
      /channels
        channels.ts         create/join/leave, membership
        buffer.ts           ring buffer for a channel
        passwords.ts        hash + verify
      /messages
        messages.ts         append, fetch-since, history
        mentions.ts         parse + filter
        ids.ts              monotonic allocator
      /presence
        presence.ts         active/inactive/evicted classification
        sweep.ts            periodic eviction
      /profiles
        profiles.ts         whois, set_profile
      /listen
        listen.ts           long-poll waiter
      /ratelimit
        ratelimit.ts        per-nick bucket
      /store
        store.ts            the one place state lives; wires the above
        config.ts           env -> Config
      /http
        server.ts           node:http bootstrap
        router.ts           tiny path+method router
        handlers.ts         one handler per tool
        mcp-config.ts       /mcp-config endpoint
      /mcp
        server.ts           MCP wiring over the same handlers
      /web
        index.html
        app.js
        styles.css
      /agent
        loop.ts             listen -> llm -> say
        openrouter.ts       fetch wrapper
        config.ts           agent.json schema + loader
      /cli
        cli.ts
      /bin
        yap.ts              dispatch (server | cli | agent | mcp)

Unit tests live alongside the code (`buffer.ts` + `buffer.test.ts`). Integration, MCP, and e2e tests live under `/test` where they need shared fixtures.

    /test
      /integration          state + http wired together, in-process
      /mcp                  MCP endpoint driven by the MCP client SDK
      /e2e                  playwright against the real bin

## Testing strategy

1. **Unit (`node:test`).** Pure helpers and per-module functions. Property-style tests for the invariants in `DESIGN.md`: monotonic IDs, unique-per-channel, `poll(since=X)` returns nothing with id ≤ X, `who` never includes evicted nicks, password hashes never leave the server. Fast; run on every save.
2. **Integration.** Start the HTTP server on an ephemeral port. Hit each tool endpoint. Assert state transitions and cross-tool behaviour (`join` then `poll`, `say` then mention surfacing, eviction after clock advance). A controllable `clock` is injected so tests don't wait on real time.
3. **MCP conformance.** Stand up the MCP endpoint. Connect with the official MCP client SDK. Call every tool. Assert JSON shapes match the contracts in `DESIGN.md`. Assert `/mcp-config` returns a valid client blob.
4. **E2E (Playwright).** Two browser contexts in the same channel exchange messages. A third context acts as an MCP client and tags the browsers; the browsers see it. `@mentions` highlight, `/me` renders, refresh preserves nick via cookie, password-gated channel rejects bad password. The harness starts the real `yap` binary.
5. **CI.** `tsc --noEmit`, `node --test`, `playwright test`. No build stage.

## Documentation discipline

- `README.md` stays the elevator pitch.
- `PHILOSOPHY.md` stays canonical. Every PR that adds surface area re-reads it.
- `DESIGN.md` stays the contract. Tool contracts in the doc are the tool contracts in code; a test asserts the JSON shapes match.
- `TODO.md` is the roadmap; work top-down, don't skip.
- `ARCHITECTURE.md` (this file) covers the build and code-organisation decisions.
- Per-module header comments only where the "why" is non-obvious (e.g. why `listen` uses an `AbortController` rather than `setTimeout` chains). Identifiers carry the "what".
- JSDoc on exported functions so editors render signatures. No doc site.
- `examples/` holds a hand-rolled `planner.json` agent config, referenced from the README.

## Milestone mapping

Follows `TODO.md`.

- **v0.1.0** lands `/src/channels`, `/src/messages`, `/src/presence`, `/src/profiles`, `/src/store`, `/src/http`, `/src/web`, plus unit + integration + a basic Playwright smoke test. MCP is added before shipping so Claude Code can connect.
- **Live with it** phase: no new deps, no new abstractions. Notes only.
- **v1.0.0** adds `/src/agent`, `/src/cli`, the web agent creator, OpenRouter BYOK OAuth, and rate limits. Each lands behind the test suites above before the next starts.

## Guardrails

- **No build step, ever.** If a tool requires compilation, it doesn't ship.
- **No framework.** `node:http` plus a small router is enough. Keeping the whole server readable in one sitting is the product.
- **No ORM, no DB.** State is a `Map`. Restart wipes it. That's the spec.
- **No new dependency without a PR note** explaining why a builtin or ~20 lines won't do.
- **Philosophy veto.** Any feature that can't be implemented by a client polling and saying things gets reviewed against `PHILOSOPHY.md` before touching the server.

The result is a ~1–2k LOC server that boots instantly, has no build artifacts, type-checks in editors, and whose test suite exercises it the way real clients do.
