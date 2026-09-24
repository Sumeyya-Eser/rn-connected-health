# rn-connected-health

A Claude Code plugin for React Native apps that connect to BLE health devices and sync their data to Apple HealthKit and Android Health Connect. It covers device setup and parsing, background sync, firmware updates, testing, Expo configuration, and health-data compliance.

## What's inside

### Skills (Claude loads these automatically when they're relevant)

| Skill | Covers |
|---|---|
| `ble-react-native` | Permissions, scanning, GATT queue, MTU, reconnection, bonding. Includes **tested, dependency-free parsers** for all Bluetooth SIG health profiles |
| `ble-background-sync` | iOS state restoration and `bluetooth-central`, Android foreground services (`connectedDevice`), Doze, periodic sync, outbox pattern |
| `ble-testing` | Parser fixtures, a Jest mock for `react-native-ble-plx`, a fake device service for UI and E2E tests, a hardware test bench |
| `ble-firmware-update` | Nordic DFU, MCUmgr/SMP, connection handover, pre-flight checks, recovery, medical change control |
| `expo-connected-health` | Config plugins, dev client, CNG/prebuild, EAS, writing local config plugins |
| `health-data-integration` | HealthKit and Health Connect setup, BLE → health store mapping with validation and dedupe, sync strategy, store review |
| `health-compliance` | KVKK, GDPR, HIPAA applicability, security of health data, App Store and Play health policies, MDR/FDA/IEC 62304 signals |

### Commands

| Command | What it does |
|---|---|
| `/ble-setup [device-type]` | Sets up react-native-ble-plx with a service layer, GATT queue, reconnect logic, parsers and a Jest mock |
| `/ble-parser [characteristic \| sample hex]` | Adds a tested parser for a SIG characteristic or a vendor protocol |
| `/health-setup [data types]` | Sets up HealthKit and Health Connect behind one `HealthStore` interface, with validated mapping |
| `/health-review [focus]` | Store, privacy, security and regulatory readiness audit |

### Agents

| Agent | Use it for |
|---|---|
| `ble-debugger` | Diagnosing BLE bugs step by step (scan, connect, GATT 133, missing notifications, wrong values, background) |
| `ble-protocol-analyzer` | Decoding hex or base64 dumps and working out the frame format of vendor protocols (checksums, scaling, opcodes) |
| `health-compliance-reviewer` | A read-only review of health data flows, storage, logging, permissions and claims, with evidence for each finding |

### Bundled code (tested, zero dependencies)

| File | Contents |
|---|---|
| `skills/ble-react-native/assets/healthParsers.ts` | SFLOAT/FLOAT, Date Time, base64 without `Buffer`; heart rate, blood pressure, thermometer, weight, glucose + RACP, pulse oximeter, DIS and battery parsers; `parseCharacteristic(uuid, base64)` dispatcher |
| `skills/ble-react-native/assets/gattQueue.ts` | Serialised GATT operations with timeouts, and reconnect backoff |
| `skills/health-data-integration/assets/healthMapping.ts` | Plausibility checks, device-vs-phone timestamps, deterministic dedupe IDs, HealthKit and Health Connect write descriptors |

```bash
node --experimental-strip-types --test skills/*/assets/*.test.ts   # Node ≥ 22.6
```

## Install

```
/plugin marketplace add sumeyya-eser/rn-connected-health
/plugin install rn-connected-health@sumeyya-plugins
```

To test locally:

```
claude --plugin-dir ~/claude-plugins/rn-connected-health
```

## Evals

`evals/` contains scenario tests for Claude's behaviour with the plugin loaded, such as flag decoding, kPa vs mmHg, SpO₂ fraction vs percent, glucose RACP, HealthKit read privacy and PHI in crash reports. Run them with:

```
claude plugin eval .
```

CI (`.github/workflows/ci.yml`) runs the asset unit tests and plugin validation on every push. Evals run on manual dispatch because they need `ANTHROPIC_API_KEY`.

## Disclaimer

This plugin helps with software integration. It doesn't give medical, legal or regulatory advice. The bundled parsers and mapping are tested, but they are not validated medical device software. Apps that interpret medical measurements may be regulated as medical device software (for example under EU MDR or by the FDA).

## Author

Sümeyya Eser Arslan: https://sumeyya-eser.github.io/

## License

MIT
