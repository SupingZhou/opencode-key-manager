# OpenCode Key Manager — Design Document

## Architecture Overview

Single-file TUI plugin (`tui.tsx`, ~690 lines) registered as a `sidebar_content` slot in OpenCode's TUI plugin API (`order: 55`). Built with SolidJS + `@opentui/solid` for terminal UI rendering.

```
┌─────────────────────────────────────────────────┐
│  Plugin Entry (tui.tsx)                          │
│  ┌─────────────────────────────────────────────┐│
│  │  Module exports                             ││
│  │  ├─ id: "opencode-key-manager"             ││
│  │  └─ tui(api) → TuiPlugin                   ││
│  │                                             ││
│  │  State                                      ││
│  │  ├─ profiles: Signal<KeyProfile[]>          ││
│  │  ├─ activeIds: Signal<Record<string,str>>   ││
│  │  ├─ folds: Signal<Record<string,bool>>      ││
│  │  ├─ panelWidth: Signal<number>              ││
│  │  └─ usageCache: Signal<Record<str,Usage>>   ││
│  │                                             ││
│  │  Slots                                      ││
│  │  └─ sidebar_content → JSX.Element           ││
│  │      (box layout with all UI components)    ││
│  │                                             ││
│  │  Commands (7 x slash)                       ││
│  │  ├─ km.add    → /key-add                    ││
│  │  ├─ km.switch → /key-switch                 ││
│  │  ├─ km.edit   → /key-edit                   ││
│  │  ├─ km.delete → /key-delete                 ││
│  │  ├─ km.list   → /key-list                   ││
│  │  ├─ km.status → /key-status                 ││
│  │  └─ km.sync   → /key-sync                   ││
│  └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

## Data Model

### KeyProfile

```typescript
interface KeyProfile {
  id: string         // crypto.randomUUID(), immutable
  label: string      // user-assigned display name
  apiKey: string     // the raw API key (sk-...)
  providerID: string // provider identifier, e.g. "opencode-go"
}
```

### Active Key (Per-Provider)

Single global `activeId` was replaced by a `Record<providerID, keyID>` map (`activeIds`). This allows:

- Each provider group to have an independent active key
- Delete inside one provider does not affect other providers' active state
- Migration from old single-value format (`km_active` → `km_active_ids`)

### Groups

Derived from `profiles()` via `Map<providerID, KeyProfile[]>`, sorted alphabetically. Each group renders as a foldable section.

## KV Store Schema

| Key | Type | Purpose |
|---|---|---|
| `km_list` | `KeyProfile[]` | Persisted profile list (source of truth) |
| `km_active_ids` | `Record<string, string>` | Active key ID per provider |
| `km_folds` | `Record<string, boolean>` | Fold/collapse state per provider |

All KV operations happen through `api.kv.set()` / `api.kv.get()`, scoped to the plugin and workspace.

### Config Backup

On every profile mutation (`persistProfiles`), the full list + active IDs are backed up to `opencode.jsonc`:

```json
"plugins": {
  "opencode-key-manager": {
    "list": [...],
    "activeIds": { "siliconflow": "uuid-1", ... }
  }
}
```

On startup, `restoreFromConfig()` reads this backup if the KV store is empty (e.g., fresh workspace without initialized KV).

## Color System

### Morandi Palette

All theme colors pass through a desaturation pipeline to cap saturation at ≤0.28 (matching Visual-Cache plugin visual style).

```typescript
const pal = {
  primary: desaturateTo(t.primary, MAX_SAT, FALLBACK.primary),
  text:    desaturateTo(t.text,    MAX_SAT, FALLBACK.text),
  muted:   desaturateTo(t.textMuted, MAX_SAT, FALLBACK.muted),
  success: desaturateTo(t.success, MAX_SAT, FALLBACK.success),
  border:  desaturateTo(t.border,  MAX_SAT, FALLBACK.border),
}
```

### Algorithm

`desaturateTo(raw, maxSat, fallback)`:

1. Parse input (`#hex` or `{r,g,b}` object) → RGB
2. Compute HSL saturation
3. If saturation ≤ maxSat → return as-is
4. If over limit → binary-search toward luma (grayscale equivalent) until saturation drops below threshold
5. Fallback to hardcoded Morandi constants (e.g., `#C5C5BB` for text) if theme color cannot be parsed

### Palette Constants

| Key | Hex | Role |
|---|---|---|
| `primary` | `#8B9DAF` | Interactive elements, headers |
| `text` | `#C5C5BB` | Primary text |
| `muted` | `#7A7A72` | Secondary text, separators |
| `success` | `#9CAF8B` | Active key indicator |
| `border` | `#6B6B63` | Panel border |

## Component Tree (JSX)

```
box [border, borderStyle=round, borderColor=pal.border, padding=2]
├── box [flexDirection=row, gap=1]
│   ├── text (title, click→sync)        "Key Manager"
│   ├── text (click→add)                "[+]"
│   ├── text (click→edit)               "[E]"
│   └── text (click→delete)             "[X]"
├── text                                 sep() ──── dynamic separator
├── (if no groups) text                 "No keys yet"
├── ForEach(groups) → <>
│   ├── (if idx>0) text                 sep() (separator between groups)
│   ├── box [flexDirection=row]
│   │   ├── text (click→fold)           "▼/▶ provider (N) [active label]"
│   │   └── Show(expanded) text         "[+]"
│   └── Show(expanded) → ForEach(key)
│       └── text (click→switch)         "●/○ key-label [config]"
├── text                                 " "
└── text                                 "> /key- for all commands"
```

## Layout

### Sidebar Panel

```
┌─────────────────────────┐
│ Key Manager [+][E][X]  │  ← title row (click title = sync)
├─────────────────────────┤
│                         │  ← ── dynamic separator (panelWidth - gutter)
│ ▼ providerA (3)  [+]   │  ← provider header (click to fold/unfold)
│   ○ key1               │
│   ● key2               │  ← active key (●), inactive (○)
│   ○ key3               │
│                         │  ← ── separator between groups
│ ▶ providerB (1)  [+]   │  ← folded group (shows active label inline)
├─────────────────────────┤
│ > /key- for commands    │  ← bottom hint
└─────────────────────────┘
```

### Dynamic Separator

The separator line `"\u2500"` repeats to fill `panelWidth - gutter` characters. Width is updated via `onSizeChange` callback on the outer box:

```typescript
let boxEl: any
const [panelWidth, setPanelWidth] = createSignal(26)
const gutter = 6  // border(2) + padding(4) = 6
const sep = createMemo(() => "\u2500".repeat(Math.max(1, panelWidth() - gutter)))
```

The `boxEl` ref and `onSizeChange` provide responsive behavior when the sidebar is resized.

## Key Flows

### Add Key (`startAdd` / `startAddForPid`)

```
User clicks [+] or runs /key-add
  → DialogPrompt: enter label
  → DialogPrompt: enter API key (validates sk- prefix)
  → DialogSelect: pick provider
      ├─ predefined (opencode-go, siliconflow, ...)
      └─ Custom → DialogPrompt: enter provider ID
  → commitAdd(label, key, providerID)
      → adds profile to list
      → persistProfiles → KV set + config backup
      → if providerID is new in config:
          → creates provider entry in opencode.jsonc
            (copies models from opencode-go-2 if available)
```

Auto-detected existing provider IDs appear in the picker, keeping the list relevant and reducing manual entry.

### Switch Key (`switchTo`)

```
User clicks a key row or runs /key-switch
  → persistActiveIds({ ...cur, [pid]: profile.id })
  → reads opencode.jsonc
  → writes profile.apiKey to config.provider[pid].options.apiKey
  → NOTICE: does NOT change config.model or trigger new session dialog
```

Design principle: switching a key is a **config-only operation**. The model selection is managed independently by OpenCode's own Model selector.

### Delete Key (`startDelete`)

```
User clicks [X] or runs /key-delete
  → DialogSelect: pick key
  → DialogConfirm: confirm deletion
  → removes profile from list
  → if this was the last key for that provider:
      → removes provider entry from opencode.jsonc
  → persistProfiles
  → if deleted key was the active key for its provider:
      → auto-activates first remaining key in the same provider
      → if no remaining keys, removes entry from activeIds
```

### Edit Key (`startEdit`)

```
User clicks [E] or runs /key-edit
  → DialogSelect: pick key
  → DialogPrompt: edit label
  → DialogPrompt: edit API key
  → updates profile in list
  → persistProfiles
  → if edited key is active for its provider:
      → writes new API key to config.provider[pid].options.apiKey
```

### Config Sync (`syncConfigProviders`)

```
Triggered on:
  - Plugin startup
  - Title click (manual)
  - /key-sync slash command

Process:
  → reads opencode.jsonc.provider
  → compares provider IDs against existing profiles
  → for each new provider with an apiKey:
      → creates profile with label "config:{pid}"
      → appends to list
      → persists
```

Sync is **additive only** — it never removes or modifies existing profiles. This prevents accidental data loss.

## Design Decisions

### Per-Provider Active Key (Record over string)

Replaced single `activeId` with `activeIds: Record<providerID, keyID>`.

- **Why**: Each provider group needs an independent active key. A single global active key doesn't map well when the user has keys across multiple providers.
- **Migration**: On first load, old `km_active` (string) is read and migrated to the new record format:
  - Finds the profile matching the old active ID
  - Creates `{ [profile.providerID]: oldId }`
  - Writes new format, old key is left in place (backward compatible)

### switchTo Does Not Touch Model

- **Why**: Model selection is a separate concern managed by OpenCode's Model selector. Changing the model on every key switch would be disruptive.
- **Effect**: `config.model` is never modified. Only `config.provider[PID].options.apiKey` is updated.

### Morandi Palette Over Raw Theme Colors

- **Why**: High-saturation theme colors clash in a tight sidebar panel. Desaturating to ≤0.28 creates a calm, cohesive visual language.
- **Tradeoff**: Some theme personality is lost (e.g., vibrant accent colors become muted neutrals).

### Inline Header Buttons over Bottom Bar

- **Why**: Fewer clicks. The title row already has focus; adding `[+]`, `[E]`, `[X]` there saves vertical space and keeps all controls at the top.
- **Tradeoff**: The title row is more crowded.

### Single File over Multi-Module

- **Why**: ~690 lines is manageable for a single-purpose plugin. Multi-file adds build and import complexity without meaningful benefit at this scale.
- **When to split**: If the plugin grows beyond ~1500 lines, extract palette, KV helpers, and dialog builders into separate modules.

## Security Considerations

- API keys are stored in the plugin KV store and backed up to `opencode.jsonc`
- The plugin does NOT log, expose, or transmit API keys outside of writing to config
- Key preview in `/key-status` shows only first 4 + last 4 characters (e.g., `sk-ab…wxyz`)
- The usage query feature attempts fetch requests with stored API keys; all errors are silently caught (never displayed raw)
- Dialog inputs for API keys use the default `DialogPrompt` (no mask/obscure by default, but key values are only visible during entry)

## Files

| File | Role |
|---|---|
| `tui.tsx` | Single-file plugin source (~690 lines) |
| `package.json` | npm package metadata, peer dependencies |
| `README.md` | User-facing documentation |
| `DESIGN.md` | This document |
