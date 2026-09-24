---
description: Set up BLE (react-native-ble-plx) in this React Native project with correct permissions, a singleton manager, a GATT queue, reconnection logic, SIG parsers and a Jest mock
argument-hint: "[device type, e.g. heart-rate | blood-pressure | glucose | weight | thermometer | pulse-oximeter | custom]"
---

Set up Bluetooth Low Energy in this React Native project. Target device type: $ARGUMENTS (if empty, ask the user which device or GATT services they need).

Use the `ble-react-native` skill for all rules. For Expo projects, also use `expo-connected-health`. For the mock and tests, use `ble-testing`. Steps:

1. **Inspect the project first**: React Native version, Expo (CNG / committed native folders) or bare, new architecture enabled or not, TypeScript or not, test runner, existing BLE libraries. Report what you found before changing anything.
2. **Install** `react-native-ble-plx`. On Expo, use `npx expo install` plus its config plugin and remind the user they need a dev client, because Expo Go won't work. On bare projects, run `pod install`.
3. **Android permissions**: add the permission set for API ≤ 30 and API 31+ from the skill (on Expo, through the config plugin or `android.permissions`).
4. **iOS Info.plist**: add `NSBluetoothAlwaysUsageDescription` with a specific, device-related sentence. Ask before adding the `bluetooth-central` background mode; if the user wants it, follow `ble-background-sync`.
5. **Create a BLE service layer** (match the project's folder conventions, e.g. `src/ble/`):
   - `bleManager.ts`: the singleton `BleManager` in module scope, waiting for `PoweredOn` (with restoration options if background was requested).
   - `permissions.ts`: runtime permission requests per platform and API level, including the "Location Services off" check on API ≤ 30.
   - `gattQueue.ts`: copy from the skill's `assets/gattQueue.ts` (tested). Route every read, write and MTU request through it.
   - `connection.ts`: connect with a timeout, discover, MTU (Android only), and `onDisconnected` → `queue.clear()`, then reconnect with `reconnectDelayMs` and re-subscribe. Remove subscriptions on disconnect.
   - `healthParsers.ts`: copy from the skill's `assets/` for any SIG health profile, and wire `parseCharacteristic` into the monitor callback. For `glucose`, also implement the RACP flow from `references/health-profiles.md` and persist the last sequence number per meter serial.
   - `HealthDeviceService.ts`: the interface the UI depends on, so a fake can replace it (see `ble-testing`).
6. **Expose a small hook** (e.g. `useBleDevice`) for UI screens: state, the last reading, errors translated into user-facing text, and connect/disconnect actions.
7. **Tests**: add the `react-native-ble-plx` Jest mock from `ble-testing`, the adapted parser and queue tests, and one test for "no duplicate readings after reconnect". Run them.
8. Finish with a short summary: files created, test results, what to test on a real iOS and Android device, and any manual steps (pod install, rebuilding the dev client).

Do not overwrite existing BLE code without showing the user what would change.
