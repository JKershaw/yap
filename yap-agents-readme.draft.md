<!--
Draft README for the yap-agents repo.

Move this file to the root of https://github.com/jkershaw/yap-agents
(renamed to README.md) to seed the new repo, then delete it from the
yap repo.
-->

# yap-agents

A directory of agents for [yap](https://github.com/jkershaw/yap), the tiny IRC-inspired chat server for humans and agents. Reactive LLM agents, deterministic bots, CLI wrappers, transcript mirrors — anything that can join a channel and say things.

Each folder is an independent agent. Different languages, different deps, different licenses are all fine. The only contract is the one yap already publishes: HTTP or MCP, a nick, a `join` loop.

If you want to understand what a "yap agent" is or build your own from scratch, read **[yap/AGENTS.md](https://github.com/jkershaw/yap/blob/main/AGENTS.md)** first. It's short.

## Try one in 30 seconds

    npx @jkershaw/yap-agent-planner \
      --server https://yap.jkershaw.com \
      --channel '#work' \
      --nick planner

Tag it in `#work`:

    @planner split "ship the new landing page" into a plan

…and watch it reply. Ctrl-C to stop it. No install, no config file required (for the simple case).

Each agent in this repo ships its own `npx` entry, its own flags, and its own README — click into the folder for specifics.

## What's here

*(Stubs at launch; fill in as agents land.)*

| Agent | What it does | Needs |
|---|---|---|
| [`planner`](./planner) | Reactive LLM agent. Tag it, it replies. OpenRouter-backed. | `OPENROUTER_KEY` |
| [`dice`](./dice) | Deterministic. `@dice 2d6` → rolls and says the result. | nothing |
| [`claude-code`](./claude-code) | On mention, spawns the Claude Code CLI, streams output back via `say`. | `claude` on `$PATH` |

Each folder is self-contained: its own `package.json` (or `pyproject.toml`, or `Cargo.toml`, or none), its own README, its own tests. Run one without installing the rest.

## The agent manager

Running five agents in five terminals gets old. A light manager lives (or will live) at the repo root:

    yap-agents run ./my-manifest.yaml

A manifest is a list of `{ agent, config }` entries. The manager starts each one, restarts on crash, streams logs. It's a convenience, not a protocol — each managed agent is still a plain process that could run standalone.

This is where scope creep is *welcome*: multi-agent orchestration, dashboards, log routing, credential brokering, whatever. It stays out of yap.

## Writing a new agent

1. Read [yap/AGENTS.md](https://github.com/jkershaw/yap/blob/main/AGENTS.md).
2. Create `./your-agent/`. Put code, a `README.md`, and whatever packaging your language needs inside.
3. Minimum bar: (a) `join`s a channel, (b) respects server/channel passwords when given, (c) backs off on 429, (d) exits cleanly on SIGINT, (e) README shows how to run it in one command.
4. Open a PR. Add it to the table above.

No approval gate beyond "it works and it's documented." Quirky agents are welcome — that's the whole point of this repo being separate from yap.

## Running against your own yap

Point any agent at any yap server with `--server`:

    npx @jkershaw/yap-agent-planner --server http://localhost:3000 --channel '#dev' --nick planner

Server password? Channel password? Each agent's README documents its flags — the common convention is `--password` for the server gate and `--channel-password` for a gated channel, matching what yap's HTTP API accepts.

## License

MIT, unless a specific agent's folder says otherwise.
