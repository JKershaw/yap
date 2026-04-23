# TODO

Ordered. Each item unblocks the next. Don't skip ahead.

## v0.1.0 — prove the core loop ✅ shipped

1. ~~**Grab the namespace.** Register `@jkershaw/yap` on npm (empty package). Create the GitHub repo with just `README.v0.1.0.md` (renamed to `README.md`), `PHILOSOPHY.md`, `DESIGN.md`. No code yet.~~

2. ~~**Scaffold the package.** Node project, TypeScript (no build step, `--experimental-strip-types`), single `bin` entry (`yap`). One package, `/src/{channels,messages,presence,listen,ratelimit,store,http,mcp,web,bin}`.~~

3. ~~**Build the in-memory state layer.** Channels, buffers, members, monotonic IDs, parsed mentions, scrypt passwords, per-nick rate limiter, long-poll waiters with AbortController. Pure functions over a single `Store` value; unit tests cover the DESIGN.md invariants.~~

4. ~~**Wrap it in an HTTP API.** `POST /api/{join,leave,say,poll,listen,who,history}` with plain JSON in/out. Tiny `node:http` router. Integration tests spin the server on an ephemeral port and exercise every endpoint.~~

5. ~~**Build the minimal web UI.** Single HTML file, plain JS with `@ts-check` + JSDoc. Nick + channel + password landing form, message list, input box, who-panel. Polls the HTTP API every 2s. Cookie persists the nick across refresh.~~

6. ~~**Get two humans chatting.** Covered by the Playwright e2e: two browser contexts in the same channel exchanging messages, `@mentions` highlighted, `/me` rendered, refresh keeps the nick, password-gated channel rejects the wrong password.~~

7. ~~**Add the MCP endpoint.** Same seven tools wrapped via `@modelcontextprotocol/sdk` on a stateless `StreamableHTTPServerTransport`. `GET /mcp-config` returns a paste-ready blob (pre-filled `Authorization` header when `YAP_PASSWORD` is set).~~

8. ~~**Connect Claude Code.** MCP conformance tests drive every tool via the official client SDK, including password-gated flows and client-disconnect cancellation of `listen`.~~

9. ~~**Polish to shippable.** `@mentions` render, `/me` actions, readable on mobile, optional `YAP_PASSWORD` gate (Bearer / cookie / query-param-rewrites-to-cookie), per-nick `say` rate limit (`YAP_RATE_LIMIT`, default 30/min), graceful 400/401/403/404/413/429 errors, constant-time password comparisons, body-size cap.~~

10. **Release v0.1.0.** Publish to npm. Deploy to `yap.jkershaw.com`. ← **next step for the maintainer**

## Between releases — live with it

11. **Use it for real.** A week or two. Notice what's missing, what's annoying, what you reach for that isn't there. Do not add features during this phase — just note them.

12. **Re-read `PHILOSOPHY.md`.** Cut any noted features that don't survive the re-read. This gate repeats between every minor release.

### v0.1.0 housekeeping carried over

- Split `src/http/server.ts` (310 lines) into `server.ts` + `auth.ts` once another feature bumps it.
- Add structured logging (pino) once the hosted instance has a reason to need it; until then, `console.error` is enough. Dep is intentionally not shipped in v0.1.0.

## v0.2.0 — reactive agent runtime

The biggest philosophy-validator: proves agents are clients. Once this lands, the repo has example agents to point at whenever someone asks for a plugin system.

13. **Reactive agent runtime.** `yap agent --config agent.json` as a new bin entry. Implements the listen-loop → LLM → say cycle. OpenRouter only to start. `agent.json` schema in `/src/agent/config.ts`, loop in `/src/agent/loop.ts`, fetch wrapper in `/src/agent/openrouter.ts`.

14. **Ship an example.** A hand-rolled `examples/planner.json` referenced from the README. Enough to run `yap agent --config examples/planner.json` and see it join a channel, respond to mentions, and leave cleanly on Ctrl-C.

15. **Tests.** Unit coverage for the loop's state transitions (with a stub LLM). Integration coverage starting a real agent against a real server on ephemeral ports. No network-touching tests.

16. **Release v0.2.0.** Bump version, publish, update the hosted instance, add an "Agents" section to the README.

## v0.3.0 — CLI client

Small, independent, good dogfooding for anyone who doesn't want a browser tab open. Could slip to later if v0.2 turns up runtime work that needs finishing.

17. **CLI client.** `yap cli` as another bin entry. Terminal chat client against any server URL. Reads from stdin, renders incoming messages with the same presence/mention conventions as the web UI. Uses the HTTP API, not MCP — it's a human client.

18. **Tests.** Integration coverage against the real server; snapshot the rendered output for a scripted conversation.

19. **Release v0.3.0.**

## v0.4.0 — profiles

Small and additive. Lands here rather than earlier because `set_profile` is most useful when agents exist to call it on boot; `whois` is most interesting when there's a mix of humans and agents in a channel.

20. **Add `/src/profiles`.** `whois(nick)` and `set_profile(description)` as defined in `DESIGN.md`. Description lives on the nick and is evicted with it. Wire into HTTP and MCP handlers alongside the existing tools.

21. **Tests.** Unit coverage for the module; integration coverage for `set_profile` then `whois` across channels; MCP conformance for both tools.

22. **Agent runtime integration.** The agent loop calls `set_profile` on startup using the description from `agent.json` so `whois` returns something useful immediately.

23. **Release v0.4.0.** Add the two tools to the README tool list.

## v0.5.0 — web-based agent creator

Depends on v0.2's runtime. In-browser form, server-hosted execution when `OPENROUTER_KEY` is set, otherwise falls back to generating a downloadable `agent.json`.

24. **Web agent creator UI.** Form in the web UI: name, description, channels, system prompt, model. Mirrors the `agent.json` schema exactly so the server-hosted and downloadable paths produce identical configs.

25. **Server-hosted agents.** When `OPENROUTER_KEY` is set, spin up an in-process agent using the v0.2 runtime with isolated state per agent. From the protocol's perspective, server-hosted and locally-run agents are indistinguishable.

26. **Downloadable fallback.** When no key is set, the form returns an `agent.json` blob the user can run locally with `yap agent`.

27. **Tests.** E2e coverage for both paths. Integration coverage for the create → listen → say cycle end-to-end on the server-hosted path.

28. **Release v0.5.0.**

## v0.6.0 — BYOK OAuth

Only meaningful once the web creator exists. Optional — only enabled if `OPENROUTER_OAUTH_CLIENT_ID` is set.

29. **OpenRouter OAuth integration.** Standard OAuth flow, tokens stored in-memory per nick, evicted with the nick. Server-hosted agents use the creator's token rather than the server's `OPENROUTER_KEY`.

30. **Tests.** Integration coverage with a stub OAuth provider. Assert tokens never leak across nicks and never appear in logs.

31. **Release v0.6.0.**

## v0.7.0 — abuse guards and observability

Everything the live deployment has taught us by now. Scope is deliberately soft because the right list is whatever the hosted instance actually needs.

32. **Abuse guards beyond per-nick rate limits.** Per-IP channel creation caps, hosted-instance defaults, and any further protections the live deployment turns out to need.

33. **Observability polish.** Read-only channel views (shareable spectate links), better rendering of system events, maybe a small "who's here" sidebar.

34. **Admin endpoints.** `POST /admin/purge` and `POST /admin/block` behind `YAP_ADMIN_TOKEN`, per the rejected-ideas doc. Curl-only, no UI.

35. **Release v0.7.0.**

## v1.0.0 — we've lived with all of it

No new features. The bar is: the hosted instance has been running for long enough, with enough real use, that the maintainer can call it done without flinching.

36. **Release v1.0.0.** Update the README. Tag the release. Write a short blog post if the mood strikes.

## Never

- Anything in the "Things we will not add" list in `PHILOSOPHY.md`.
- Features added because they'd be easy, rather than because they'd be used.
- Abstractions introduced before the second concrete use case exists.
