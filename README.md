# OpenCode Key Manager

A TUI sidebar plugin for managing multiple API keys across LLM providers in OpenCode.

## Features

- **Per-provider active key** — each provider group has its own active key; switching only updates `provider[PID].options.apiKey`, never touches `model`
- **Inline management** — add, edit, delete, and switch keys from the sidebar without leaving the TUI
- **Config sync** — automatically discovers new providers from `opencode.jsonc` and imports them as `config:` entries
- **Slash commands** — full set of `/key-*` commands for fast keyboard-driven workflows
- **Morandi palette** — theme colors automatically desaturated to ≤0.28 saturation, matching Visual-Cache visual style
- **Config backup** — key list and active IDs are persisted to `opencode.jsonc` under `plugins.opencode-key-manager`

## Installation

```bash
# npm
npm install opencode-key-manager

# bun
bun add opencode-key-manager

# pnpm
pnpm add opencode-key-manager
```

Register the plugin in `tui.jsonc` or `opencode.jsonc`:

```json
"plugin": ["opencode-key-manager"]
```

Restart OpenCode. The **Key Manager** panel appears in the sidebar.

## Setup

For a new provider, configure it via OpenCode's `/connect` command first:

```
/connect deepseek     → enter API key, provider is set up with correct models
/connect siliconflow  → same for SiliconFlow
```

After connecting, run `/key-sync` or restart OpenCode — the provider is auto-imported as a `config:` key entry.

To add additional keys for an already-connected provider:

1. Click the provider header `[+]` or run `/key-add`
2. Enter a label and the API key
3. The key is now available to switch to

New providers discovered in `opencode.jsonc` are auto-imported during sync (triggered on startup or manually via `/key-sync`).

> **Note:** Use `/connect {provider}` to add a new provider. `/key-add` only works for providers already configured in `opencode.jsonc`.

## Commands

| Slash | Action |
|---|---|
| `/key-add` | Add a new API key for an already-connected provider |
| `/key-switch` | Switch active key across all providers |
| `/key-edit` | Edit an existing key's label or value |
| `/key-delete` | Remove a key (auto-activates first remaining key in same provider) |
| `/key-list` | List all configured keys with active status |
| `/key-status` | Show current active key details (label, provider, key preview) |
| `/key-sync` | Scan `opencode.jsonc.provider` for new providers and import them |

All commands also appear in the `/key-` autocomplete menu.

## Sidebar Controls

| Element | Action |
|---|---|
| **Title row** `[Key Manager] [E] [X]` | Title click → sync providers; `[E]` → edit a key; `[X]` → delete a key |
| **Provider header** `▶ siliconflow (3) [+]` | Click provider name → fold/unfold; `[+]` → add key pre-selected for this provider |
| **Key row** `● work-key` | Click → switch to this key (activated indicator: ● = active, ○ = inactive) |
| **Bottom hint** `> /key- for all commands` | Reminder of slash prefix |

## Development

### Prerequisites

- Node.js ≥ 18 or Bun ≥ 1.0
- OpenCode ≥ 1.14.0

### Local workflow

```bash
# Clone / create the plugin
cd D:\opencode-key-manager

# Edit the source
# tui.tsx is the single-file plugin (~690 lines)

# Deploy — copy to OpenCode's plugin cache
Copy-Item tui.tsx "$env:USERPROFILE\.cache\opencode\packages\opencode-key-manager@latest\node_modules\opencode-key-manager\tui.tsx" -Force

# Restart OpenCode to reload the plugin
```

### Publish

```bash
# Update version in package.json
# Publish to npm
npm publish
```

## Visibility

The plugin shows active configuration even when the session is idle. It reads key state from the plugin KV store (`km_list`, `km_active_ids`, `km_folds`) and syncs bidirectionally with `opencode.jsonc`.

Provider groups without entries show a "No keys yet" placeholder and sync indicator.

## License

MIT
