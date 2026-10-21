export const HELP = `splates dev eval [fast|list|plan|report] [options]
  --probe ID | --aspect NAME | --requirement ID (repeatable; groups intersect)
  --kind cli|agent        select local CLI checks or agent probes
  --module PATH            explicit ProbeModule; default discovers *.probes.ts
  budgets [set <tokens/window|nothing>|reset] [--format json]  free shared token budget controls
  --target agent:model     native claude:MODEL, codex:MODEL, opencode:PROVIDER/MODEL, each optionally
                           MODEL@EFFORT for a thinking level (repeat)
  --skill-mode discovery|explicit  native skill loading (default discovery)
  --codex-fixture-writes  opt in to validated isolated decision task/metadata writes
  --codex-home PATH        existing native auth/config in place; may write runtime metadata
  --reserve-tokens 1000000 --reserve-usd 2  per-session reservation, not estimated price
  --parallel 1 --reps 1    bounded independent combinations
  --milliseconds N --turns N --tokens N   override each probe's bounds
  --baseline REV          required Git baseline for skill/reference change gate
  --paired                both immutable snapshots, both families, one aggregate reservation; frozen decision probes only
  --unchanged-baseline    explicit same-skill exception: any explicit --probe/--aspect/--requirement selection, Claude alone or one Codex and one Claude, one repetition, parallel one
  --max-tokens 10000000 --max-usd 20  aggregate admission limits, within the shared budgets
  --allow-unmetered        rejected for model execution
  --yes                    start paid probes without the terminal confirmation
  --failed                 rerun compatible non-passing probes; report filters non-passes
  --skill DIR --directory DIR
  plan                     free change-gated smoke selection; no model launch
  report                   read-only deterministic report, no agent or grader
  e2e report ...           free saved legacy reports; execution lacks enforced metering`;
