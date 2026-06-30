/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule, TuiSlotContext } from "@opencode-ai/plugin/tui"
import { createSignal, createMemo, Show } from "solid-js"

interface KeyProfile {
  id: string
  label: string
  apiKey: string
  providerID: string
}

const KV_LIST = "km_list"
const KV_ACTIVE_IDS = "km_active_ids"
const KV_FOLDS = "km_folds"
const KV_PLUGIN_FOLD = "km_plugin_fold"
const CFG_BACKUP_KEY = "plugins.opencode-key-manager"

function uid(): string {
  return crypto.randomUUID()
}

function rgb(raw: unknown): { r: number; g: number; b: number } | null {
  if (typeof raw === "string" && raw.startsWith("#")) {
    const h = raw.slice(1)
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>
    if (typeof o.r === "number" && typeof o.g === "number" && typeof o.b === "number") {
      const scale = o.r > 1 || o.g > 1 || o.b > 1 ? 1 : 255
      return {
        r: Math.round(o.r * scale),
        g: Math.round(o.g * scale),
        b: Math.round(o.b * scale),
      }
    }
  }
  return null
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  const delta = max - min
  if (delta === 0) return 0
  const L = (max + min) / 2
  return L <= 0.5 ? delta / (max + min) : delta / (2 - max - min)
}

function desaturateTo(raw: unknown, maxSat: number, fallback: string): string {
  const c = rgb(raw)
  if (!c) return fallback
  const sat = saturation(c.r, c.g, c.b)
  if (sat <= maxSat) {
    return "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("")
  }
  const luma = c.r * 0.299 + c.g * 0.587 + c.b * 0.114
  let lo = 0, hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    const nr = Math.round(c.r + (luma - c.r) * mid)
    const ng = Math.round(c.g + (luma - c.g) * mid)
    const nb = Math.round(c.b + (luma - c.b) * mid)
    if (saturation(nr, ng, nb) > maxSat) lo = mid
    else hi = mid
  }
  const nr = Math.round(c.r + (luma - c.r) * hi)
  const ng = Math.round(c.g + (luma - c.g) * hi)
  const nb = Math.round(c.b + (luma - c.b) * hi)
  return "#" + [nr, ng, nb].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

const MAX_SAT = 0.28
const FALLBACK = {
  primary: "#8B9DAF",
  text:    "#C5C5BB",
  muted:   "#7A7A72",
  success: "#9CAF8B",
  border:  "#6B6B63",
} as const

async function tui(api: TuiPluginApi): TuiPlugin {
  const [profiles, setProfiles] = createSignal<KeyProfile[]>([])
  const [activeIds, setActiveIds] = createSignal<Record<string, string>>({})
  const [folds, setFolds] = createSignal<Record<string, boolean>>({})
  const [pluginFold, setPluginFold] = createSignal(false)
  let boxEl: any
  const [panelWidth, setPanelWidth] = createSignal(26)
  const gutter = 6
  const sep = createMemo(() => "\u2500".repeat(Math.max(1, panelWidth() - gutter)))

  const groups = () => {
    const map = new Map<string, KeyProfile[]>()
    for (const p of profiles()) {
      const arr = map.get(p.providerID) ?? []
      arr.push(p)
      map.set(p.providerID, arr)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }

  const isExpanded = (pid: string): boolean => folds()[pid] !== false

  async function persistProfiles(list: KeyProfile[]) {
    api.kv.set(KV_LIST, list)
    setProfiles(list)
    await backupToConfig(list)
  }

  function persistActiveIds(ids: Record<string, string>) {
    api.kv.set(KV_ACTIVE_IDS, ids)
    setActiveIds(ids)
  }

  function persistFold(pid: string, expanded: boolean) {
    const cur = folds()
    const next = { ...cur, [pid]: expanded }
    api.kv.set(KV_FOLDS, next)
    setFolds(next)
  }

  function persistPluginFold(val: boolean) {
    api.kv.set(KV_PLUGIN_FOLD, val)
    setPluginFold(val)
  }

  function readKV() {
    const list = api.kv.get<KeyProfile[]>(KV_LIST, [])
    setProfiles(list)
    setFolds(api.kv.get<Record<string, boolean>>(KV_FOLDS, {}))
    setPluginFold(Boolean(api.kv.get<boolean>(KV_PLUGIN_FOLD, false)))
    const old = api.kv.get<string | null>("km_active", null)
    let ids = api.kv.get<Record<string, string>>(KV_ACTIVE_IDS, {})
    if (old && Object.keys(ids).length === 0) {
      const p = list.find(x => x.id === old)
      if (p) ids = { [p.providerID]: old }
      api.kv.set(KV_ACTIVE_IDS, ids)
    }
    setActiveIds(ids)
  }

  async function restoreFromConfig() {
    if (profiles().length > 0) return
    try {
      const res = await api.client.global.config.get()
      if (res.error) return
      const cfg: any = res.data
      const saved = cfg?.plugins?.["opencode-key-manager"]?.list
      if (Array.isArray(saved) && saved.length > 0) {
        api.kv.set(KV_LIST, saved)
        setProfiles(saved)
      }
      const savedOld = cfg?.plugins?.["opencode-key-manager"]?.activeId
      const savedIds = cfg?.plugins?.["opencode-key-manager"]?.activeIds
      let ids = savedIds ?? {}
      if (savedOld && !savedIds) {
        const p = profiles().find(x => x.id === savedOld)
        if (p) ids = { [p.providerID]: savedOld }
      }
      if (Object.keys(ids).length > 0) {
        api.kv.set(KV_ACTIVE_IDS, ids)
        setActiveIds(ids)
      }
    } catch {}
  }

  async function syncConfigProviders() {
    try {
      const res = await api.client.global.config.get()
      if (res.error) { toast("syncConfigProviders: config read failed"); return }
      const cfg = res.data
      const providers = cfg?.provider ?? {}
      const existing = new Set(profiles().map(p => p.providerID))
      const news: KeyProfile[] = []
      for (const [pid, pcfg] of Object.entries(providers)) {
        if (existing.has(pid)) continue
        const opts = (pcfg as any)?.options
        if (!opts?.apiKey) continue
        news.push({
          id: uid(),
          label: "config:" + pid,
          apiKey: opts.apiKey,
          providerID: pid,
        })
      }
      if (news.length > 0) {
        const merged = [...profiles(), ...news]
        api.kv.set(KV_LIST, merged)
        setProfiles(merged)
      }
    } catch (e) { toast("syncConfigProviders error: " + String(e)) }
  }

  async function backupToConfig(list: KeyProfile[]) {
    try {
      const res = await api.client.global.config.get()
      if (res.error) return
      const cfg: any = res.data
      await api.client.global.config.update({
        config: {
          ...cfg,
          plugins: {
            ...((cfg as any)?.plugins ?? {}),
            "opencode-key-manager": { list, activeIds: activeIds() },
          },
        },
      })
    } catch {}
  }

  async function switchTo(profile: KeyProfile) {
    const cur = activeIds()
    if (cur[profile.providerID] === profile.id) return

    persistActiveIds({ ...cur, [profile.providerID]: profile.id })

    try {
      const res = await api.client.global.config.get()
      if (res.error) { toast("Read config failed"); return }
      const cfg = res.data
      const providers = { ...(cfg?.provider ?? {}) }
      providers[profile.providerID] = {
        ...(providers[profile.providerID] ?? {}),
        options: { apiKey: profile.apiKey },
      }
      const up = await api.client.global.config.update({
        config: { ...cfg, provider: providers },
      })
      if (up.error) { toast("Write config failed"); return }
      toast("Switched to " + profile.label)
    } catch (e) {
      toast("Switch failed: " + String(e))
    }
  }

  async function commitAdd(label: string, apiKey: string, providerID: string) {
    const profile: KeyProfile = { id: uid(), label, apiKey, providerID }
    const list = [...profiles(), profile]
    await persistProfiles(list)

    try {
      const res = await api.client.global.config.get()
      if (res.error) { toast("Config read failed: " + res.error); return }
      const cfg = res.data
      const providers = { ...(cfg?.provider ?? {}) }
      if (!providers[providerID] || !providers[providerID]?.options?.apiKey) {
        toast('Added. Use /connect ' + providerID + ' first, then /key-sync')
        return
      }
      providers[providerID] = {
        ...(providers[providerID] ?? {}),
        options: { apiKey },
      }
      const up = await api.client.global.config.update({
        config: { ...(cfg ?? {}), provider: providers },
      })
      if (up.error) { toast("Config write failed: " + up.error); return }
      toast('Added "' + label + '"')
    } catch (e) { toast("Add key error: " + String(e)) }
  }

  function startDelete(profile: KeyProfile) {
    api.ui.dialog.replace(() => (
      <api.ui.DialogConfirm
        title="Delete Key"
        message={'Remove "' + profile.label + '" (' + profile.providerID + ')?'}
        onConfirm={async () => {
          const list = profiles().filter(p => p.id !== profile.id)
          const remaining = list.filter(p => p.providerID === profile.providerID)

          if (remaining.length === 0) {
            try {
              const res = await api.client.global.config.get()
              if (res.error) { toast("Config read failed, abort"); return }
              const cfg = res.data
              const providers = { ...(cfg?.provider ?? {}) }
              if (providers[profile.providerID]) {
                delete providers[profile.providerID]
                const up = await api.client.global.config.update({
                  config: { ...(cfg ?? {}), provider: providers },
                })
                if (up.error) { toast("Config cleanup failed: " + up.error); return }
              }
            } catch (e) { toast("Config cleanup error: " + String(e)); return }
          }

          await persistProfiles(list)
          const ids = activeIds()
          if (ids[profile.providerID] === profile.id) {
            const next = { ...ids }
            if (remaining.length > 0) {
              next[profile.providerID] = remaining[0].id
            } else {
              delete next[profile.providerID]
            }
            persistActiveIds(next)
          }
          toast("Deleted")
        }}
      />
    ))
  }

  function startEdit(profile: KeyProfile) {
    let newLabel = profile.label
    let newKey = profile.apiKey
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="Edit Label"
        placeholder="Label"
        value={profile.label}
        onConfirm={(v) => {
          newLabel = v
          api.ui.dialog.replace(() => (
            <api.ui.DialogPrompt
              title="Edit API Key"
              placeholder="sk-..."
              value={profile.apiKey}
              onConfirm={async (v) => {
                newKey = v.trim()
                const list = profiles().map(p =>
                  p.id === profile.id ? { ...p, label: newLabel, apiKey: newKey } : p
                )
                await persistProfiles(list)
                if (activeIds()[profile.providerID] === profile.id) {
                  try {
                    const res = await api.client.global.config.get()
                    if (res.error) return
                    const cfg = res.data
                    const providers = { ...(cfg?.provider ?? {}) }
                    providers[profile.providerID] = {
                      ...(providers[profile.providerID] ?? {}),
                      options: { apiKey: newKey },
                    }
                    await api.client.global.config.update({
                      config: { ...(cfg ?? {}), provider: providers },
                    })
                  } catch {}
                }
                toast("Updated")
              }}
            />
          ))
        }}
      />
    ))
  }

  function startAdd() {
    let label = ""
    let key = ""
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="New Key"
        placeholder="Label (e.g. work-account)"
        onConfirm={(v) => {
          label = v
          api.ui.dialog.replace(() => (
            <api.ui.DialogPrompt
              title={'Key for "' + label + '"'}
              placeholder="sk-..."
              onConfirm={async (v) => {
                key = v.trim()
                if (!key.startsWith("sk-")) { toast("Key should start with sk-"); return }
                if (profiles().some(p => p.apiKey === key)) { toast("Key already exists"); return }

                const configRes = await api.client.global.config.get()
                const cfgProvs = Object.keys(configRes.data?.provider ?? {}).filter(
                  pid => configRes.data.provider[pid]?.options?.apiKey
                )
                const profilePids = [...new Set(profiles().map(p => p.providerID))]
                const pids = [...new Set([...cfgProvs, ...profilePids])].sort()
                const options = [
                  ...pids.map(p => ({ title: p, value: p })),
                  { title: "Custom (enter new ID)", value: "__custom__" },
                ]
                api.ui.dialog.replace(() => (
                  <api.ui.DialogSelect<string>
                    title="Select Provider"
                    options={options}
                    onSelect={(opt) => {
                      const pid = opt.value
                      if (pid === "__custom__") {
                        api.ui.dialog.replace(() => (
                          <api.ui.DialogPrompt
                            title="Custom Provider ID"
                            placeholder="e.g. my-provider"
                            onConfirm={(cp) => {
                              const t = cp.trim()
                              if (t) commitAdd(label, key, t)
                            }}
                          />
                        ))
                      } else {
                        commitAdd(label, key, pid)
                      }
                    }}
                  />
                ))
              }}
            />
          ))
        }}
      />
    ))
  }

  function startAddForPid(pid: string) {
    let label = ""
    api.ui.dialog.replace(() => (
      <api.ui.DialogPrompt
        title="New Key"
        placeholder={"Label for " + pid}
        onConfirm={(v) => {
          label = v
          api.ui.dialog.replace(() => (
            <api.ui.DialogPrompt
              title={'Key for "' + label + '"'}
              placeholder="sk-..."
              onConfirm={async (v) => {
                const key = v.trim()
                if (!key.startsWith("sk-")) { toast("Key should start with sk-"); return }
                if (profiles().some(p => p.apiKey === key)) { toast("Key already exists"); return }
                commitAdd(label, key, pid)
              }}
            />
          ))
        }}
      />
    ))
  }

  function editPicker() {
    const list = profiles()
    if (list.length === 0) { toast("No keys"); return }
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect<string>
        title="Edit Key"
        options={list.map(p => ({ title: p.label + " (" + p.providerID + ")", value: p.id }))}
        onSelect={(opt) => {
          const p = profiles().find(x => x.id === opt.value)
          if (p) startEdit(p)
        }}
      />
    ))
  }

  function deletePicker() {
    const list = profiles()
    if (list.length === 0) { toast("No keys"); return }
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect<string>
        title="Delete Key"
        options={list.map(p => ({ title: p.label + " (" + p.providerID + ")", value: p.id }))}
        onSelect={(opt) => {
          const p = profiles().find(x => x.id === opt.value)
          if (p) startDelete(p)
        }}
      />
    ))
  }

  function toast(msg: string) {
    api.ui.toast({ title: "Key Manager", message: msg, variant: "info" })
  }

  readKV()
  if (profiles().length > 0) await backupToConfig(profiles())
  await restoreFromConfig()
  await syncConfigProviders()

  api.command?.register(() => [
    {
      title: "Add API key",
      value: "km.add",
      description: "Add a new API key for an already-connected provider",
      slash: { name: "key-add", aliases: ["key-new"] },
      onSelect: () => startAdd(),
    },
    {
      title: "Switch API key",
      value: "km.switch",
      description: "Switch to a different API key",
      slash: { name: "key-switch", aliases: ["key-use"] },
      onSelect: () => {
        const list = profiles()
        if (list.length === 0) { toast("No keys"); return }
          api.ui.dialog.replace(() => (
            <api.ui.DialogSelect<string>
              title="Switch Key"
              options={list.map(p => ({ title: p.label + " (" + p.providerID + ")", value: p.id }))}
              onSelect={(opt) => {
                const p = profiles().find(x => x.id === opt.value)
                if (p) switchTo(p)
              }}
            />
          ))
      },
    },
    {
      title: "Edit API key",
      value: "km.edit",
      description: "Edit an existing API key label or value",
      slash: { name: "key-edit" },
      onSelect: () => editPicker(),
    },
    {
      title: "Delete API key",
      value: "km.delete",
      description: "Remove an API key from config",
      slash: { name: "key-delete", aliases: ["key-rm"] },
      onSelect: () => deletePicker(),
    },
    {
      title: "List API keys",
      value: "km.list",
      description: "Show all configured API keys",
      slash: { name: "key-list", aliases: ["key-ls"] },
      onSelect: () => {
        const list = profiles()
        if (list.length === 0) { toast("No keys"); return }
        const ids = activeIds()
        const msg = list.map(p =>
          (p.id === ids[p.providerID] ? "\u25CF " : "\u25CB ") + p.label + " (" + p.providerID + ")"
        ).join("\n")
        api.ui.toast({ title: "Key Manager", message: msg, variant: "info" })
      },
    },
    {
      title: "Show current key",
      value: "km.status",
      description: "Display the currently active API key with label, provider, model",
      slash: { name: "key-status", aliases: ["key-st"] },
      onSelect: async () => {
        try {
          const res = await api.client.global.config.get()
          if (res.error) { toast("Read config failed"); return }
          const cfg = res.data
          const model = cfg?.model ?? ""
          const parts = model.split("/")
          const activePID = parts[0] || ""
          const suffix = parts.length > 1 ? parts.slice(1).join("/") : ""
          const activeKey = cfg?.provider?.[activePID]?.options?.apiKey ?? ""

          const list = profiles()
          const match = list.find(p => p.providerID === activePID && p.apiKey === activeKey)
          const label = match ? match.label : "config:" + activePID
          const keyPreview = activeKey.length > 8
            ? activeKey.slice(0, 4) + "\u2026" + activeKey.slice(-4)
            : activeKey

          api.ui.toast({
            title: "Key Status",
            message: [
              "Label:    " + label,
              "Provider: " + activePID,
              "Key:      " + keyPreview,
            ].join("\n"),
            variant: "info",
          })
        } catch (e) {
          toast("Status read failed: " + String(e))
        }
      },
    },
    {
      title: "Sync providers from config",
      value: "km.sync",
      description: "Scan config.provider for new providers and add them as config: entries",
      slash: { name: "key-sync" },
      onSelect: async () => {
        const before = profiles().length
        await syncConfigProviders()
        const after = profiles().length
        const added = after - before
        if (added > 0) {
          toast("Synced " + added + " new provider(s)")
        } else {
          const list = profiles()
          const existing = new Set(list.map(p => p.providerID))
          toast("No new providers found (existing: " + [...existing].join(", ") + ")")
        }
      },
    },
  ])

  api.slots.register({
    order: 55,
    slots: {
      sidebar_content(ctx: TuiSlotContext, _input: { session_id: string }): JSX.Element {
        const t = ctx.theme.current
        const pal = {
          primary: desaturateTo(t.primary, MAX_SAT, FALLBACK.primary),
          text:    desaturateTo(t.text,    MAX_SAT, FALLBACK.text),
          muted:   desaturateTo(t.textMuted, MAX_SAT, FALLBACK.muted),
          success: desaturateTo(t.success, MAX_SAT, FALLBACK.success),
          border:  desaturateTo(t.border,  MAX_SAT, FALLBACK.border),
        }

        return (
          <box border borderStyle="round" {...({ borderColor: pal.border })} paddingLeft={2} paddingRight={2}
            ref={boxEl}
            onSizeChange={() => setPanelWidth(Math.max(20, boxEl?.width ?? 26))}
          >
            <box flexDirection="row" gap={1}>
              <text onMouseUp={() => persistPluginFold(!pluginFold())}>
                <span style={{ fg: pal.muted }}>{pluginFold() ? "\u25b6 " : "\u25bc "}</span>
              </text>
              <text onMouseUp={async () => { await syncConfigProviders(); toast("Synced") }}>
                <span style={{ fg: pal.primary, bold: true }}>Key Manager</span>
              </text>
              <text onMouseUp={editPicker}>
                <span style={{ fg: pal.primary }}>[E]</span>
              </text>
              <text onMouseUp={deletePicker}>
                <span style={{ fg: pal.primary }}>[X]</span>
              </text>
            </box>
            <Show when={pluginFold()}>
              <text>
                <span style={{ fg: pal.muted }}>
                  {"  "}{groups().length} providers, {profiles().length} keys
                </span>
              </text>
            </Show>
            <Show when={!pluginFold()}>
            <text>
              <span style={{ fg: pal.muted }}>{sep()}</span>
            </text>

            {groups().length === 0 && (
              <text>
                <span style={{ fg: pal.muted }}>  No keys yet</span>
              </text>
            )}

            {groups().map(([pid, keys], idx) => {
              const expanded = isExpanded(pid)
              const activeInGroup = keys.find(k => k.id === activeIds()[pid])
              return (
                <>
                  <box flexDirection="row">
                    <text onMouseUp={() => persistFold(pid, !expanded)}>
                      <span style={{ fg: pal.text }}>
                        {expanded ? "\u25bc " : "\u25b6 "}
                      </span>
                      <span style={{ fg: pal.text }}>{pid}</span>
                      <span style={{ fg: pal.muted }}> ({keys.length})</span>
                      {!expanded && activeInGroup && (
                        <span style={{ fg: pal.success }}> [{activeInGroup.label}]</span>
                      )}
                    </text>
                    <Show when={expanded}>
                      <text onMouseUp={() => startAddForPid(pid)}>
                        <span style={{ fg: pal.primary }}> [+]</span>
                      </text>
                    </Show>
                    <text>
                      <span style={{ fg: pal.muted }}>{sep().slice((expanded ? "\u25bc " : "\u25b6 ").length + pid.length + (" (" + keys.length + ")").length + (expanded ? 4 : 0) + ((!expanded && activeInGroup) ? (" [" + activeInGroup.label + "]").length : 0))}</span>
                    </text>
                  </box>

                  <Show when={expanded}>
                    {keys.map(k => {
                      const isActive = k.id === activeIds()[k.providerID]
                      return (
                        <text onMouseUp={() => switchTo(k)}>
                          <span style={{ fg: isActive ? pal.success : pal.muted }}>
                            {"  "}{isActive ? "\u25CF" : "\u25CB"}
                          </span>
                          <span style={{ fg: pal.text }}> {k.label}</span>
                          <span style={{ fg: pal.muted }}> …{k.apiKey.slice(-6)}</span>
                          {k.label.startsWith("config:") && (
                            <span style={{ fg: pal.muted }}> [config]</span>
                          )}
                        </text>
                      )
                    })}
                  </Show>
                </>
              )
            })}
            </Show>

            <text> </text>
            <text>
              <span style={{ fg: pal.muted }}>  > /key- for all commands</span>
            </text>
          </box>
        )
      },
    },
  })
}

const mod: TuiPluginModule = {
  id: "opencode-key-manager",
  tui,
}

export default mod
