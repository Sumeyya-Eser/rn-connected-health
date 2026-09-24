# Evals

Each folder is one case: `prompt.md` holds the user prompt and `graders/*.md` hold the pass criteria. `claude plugin eval` runs every case twice, with and without the plugin, and reports the difference in score.

## Design rule: test tasks, not trivia

Short factual questions (for example "what unit does HealthKit use for SpO₂?") are answered correctly with or without the plugin, and the model rarely loads a skill for them. That tells you nothing about the plugin. Every case here is a **realistic task**: write code, review code, plan a setup. The graders check the **specific details the plugin supplies** and a generic answer tends to miss:

| Case | What the plugin should add |
|---|---|
| `glucose-sync-code` | RACP procedure, indications, incremental sync by sequence number, control-solution filter |
| `bp-health-store-writer` | Deterministic dedupe (SyncIdentifier / clientRecordId), kPa conversion, validation, device vs phone time |
| `hr-connection-service` | Singleton manager, GATT queue, re-subscribe after reconnect, backoff, serial number instead of iOS `device.id` |
| `android-background-hr` | `connectedDevice` FGS + permissions, starting it from the foreground, iOS restoration, persist-first |
| `vendor-protocol-parser` | Verified checksum (sum of bytes 1–7), uint16 LE systolic, rejecting bad frames |
| `compliance-code-review` | PHI in Sentry/analytics, plaintext AsyncStorage, diagnostic claim → MDR, KVKK/GDPR consent |
| `expo-health-connect-setup` | Config plugins, per-type permission, rationale screen / activity-alias, minSdk 26, dev build |
| `dfu-update-flow` | Sync records first, battery/model pre-flight, ble-plx handover, bootloader address change, version check |

**Graders are mostly regexes, one per checked detail.** Answers to coding tasks are long (often 20–35k characters), and in a first run an LLM judge failed a code answer that met every criterion. Regexes are deterministic and free. Keep LLM graders for short, judgement-based checks with a single criterion (like the checksum rule in `vendor-protocol-parser`). Use `match: not_contains` for anti-patterns (`Promise.all(` in GATT code, random dedupe IDs) and `match: count:1` for "exactly one `new BleManager(`".

The `skill-used` grader only records whether a plugin skill fired. It is shown as an indicator and doesn't count toward the score.

## Running

```bash
# from the plugin root
claude plugin eval . --case glucose-sync-code --runs 1   # one case, cheapest check
claude plugin eval . --runs 1                            # all 8 cases × 2 arms = 16 runs
claude plugin eval .                                     # default 3 runs per case, for stable numbers
```

Results go to `evals/results/` (gitignored). A small difference between the arms on a single run is noise, so compare over 3 or more runs. The base model already handles many of these topics well, so expect a moderate difference, not a dramatic one. A case where the no-plugin arm already scores 1.0 is a signal to make that case harder or drop it.

When you add a case, start from a real task a user would give, run it once *without* the plugin, and write graders for what that answer got wrong.
