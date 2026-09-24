---
name: expo-connected-health
description: Use when a React Native project uses Expo (managed workflow, prebuild / CNG, EAS Build, dev client) and needs BLE (react-native-ble-plx), HealthKit, Health Connect, background modes or DFU — configuring config plugins in app.json/app.config.ts, permissions and entitlements without editing native folders, dev client builds, and troubleshooting "native module not found" in Expo Go.
---

# Expo + BLE + health stores

## Ground rules

- **Expo Go can't run any of this.** BLE, HealthKit and Health Connect all need native modules, so use a **development build** (`npx expo install expo-dev-client`, then `eas build --profile development` or `npx expo run:ios|android`). "Native module cannot be null" or "BleManager is not a function" means the app is running in Expo Go or on a stale build.
- With Continuous Native Generation (CNG), `ios/` and `android/` are **generated**. Put every native change in `app.json` / `app.config.ts` config plugins. Hand edits get lost on the next `npx expo prebuild --clean`.
- If a project has committed `ios/`/`android/` folders **and** config plugins, find out which one is the source of truth before changing anything. Mixed setups are the source of "my permission disappeared".
- After changing plugins: `npx expo prebuild --clean` (local) or a new EAS build. JS reloads don't apply native changes.
- Install native libraries with `npx expo install <pkg>` so the versions match the SDK.

## Config plugins

Check each plugin's README for the **installed version**. Option names change between majors.

```jsonc
// app.json → expo (comments only for illustration; app.json must be plain JSON)
{
  "ios": {
    "infoPlist": {
      // Only if you need background BLE (see ble-background-sync). Justify in App Review notes.
      "UIBackgroundModes": ["bluetooth-central"]
    }
  },
  "android": {
    "permissions": [
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT"
    ]
  },
  "plugins": [
    [
      "react-native-ble-plx",
      {
        "isBackgroundEnabled": false,
        "modes": ["central"],
        "bluetoothAlwaysPermission": "Allow $(PRODUCT_NAME) to connect to your blood pressure monitor",
        "neverForLocation": true
      }
    ],
    [
      "@kingstinct/react-native-healthkit",
      {
        "NSHealthShareUsageDescription": "Shows your blood pressure history from Apple Health.",
        "NSHealthUpdateUsageDescription": "Saves readings from your blood pressure monitor to Apple Health.",
        "background": false
      }
    ],
    "expo-health-connect",
    [
      "expo-build-properties",
      { "android": { "minSdkVersion": 26, "compileSdkVersion": 35, "targetSdkVersion": 35 } }
    ]
  ]
}
```

- `react-native-ble-plx` ships its own config plugin: it adds the BLE permissions, the usage description and, with `isBackgroundEnabled`, the background mode. `neverForLocation` adds the flag to `BLUETOOTH_SCAN` in versions that support the option. If your version ignores it, check the generated manifest and add the flag with a local plugin. Leave the flag off if you need beacon advertisements.
- Health Connect needs **per-record-type permissions**, which no plugin can guess. Add `android.permission.health.READ_*` / `WRITE_*` to `android.permissions`. `expo-health-connect` adds the rationale intent filter and the permission delegate. Check that the rationale screen actually shows your privacy policy.
- The HealthKit entitlement is added by the plugin. If you use background delivery, set `"background": true`. The App ID in the Apple Developer portal needs the HealthKit capability, and EAS syncs capabilities on build.
- Health Connect requires `minSdkVersion` 26 or higher. Set it through `expo-build-properties`, not by editing Gradle.

## Missing plugin? Write a small one

For things like an Android foreground service type, a `<queries>` entry or an `activity-alias`, add a local plugin instead of editing native files:

```ts
// plugins/withConnectedDeviceService.ts
import { ConfigPlugin, withAndroidManifest, AndroidConfig } from 'expo/config-plugins';

const withConnectedDeviceService: ConfigPlugin<{ serviceName: string }> = (config, { serviceName }) =>
  withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    AndroidConfig.Permissions.ensurePermissions(manifest, [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
      'android.permission.POST_NOTIFICATIONS',
    ]);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    app.service = (app.service ?? []).filter((s) => s.$['android:name'] !== serviceName);
    app.service.push({ $: { 'android:name': serviceName, 'android:foregroundServiceType': 'connectedDevice', 'android:exported': 'false' } } as any);
    return cfg;
  });

export default withConnectedDeviceService;
```

Register it with `["./plugins/withConnectedDeviceService", { "serviceName": "..." }]`. Keep plugins **idempotent** (filter before push) because prebuild can run them more than once.

## Verify the generated output

After `npx expo prebuild --clean`:
- `android/app/src/main/AndroidManifest.xml`: BLE permissions with the right `maxSdkVersion`, the health permissions, the rationale activity / `activity-alias`, and the FGS type.
- `ios/<App>/Info.plist`: usage strings are specific; `UIBackgroundModes` only has what you need.
- `ios/<App>/<App>.entitlements`: `com.apple.developer.healthkit`, and `...healthkit.background-delivery` if used.

Don't commit these generated folders in a CNG project. Check them locally, then discard.

## EAS

- Use separate profiles for `development` (dev client, internal distribution), `preview` and `production`. A fake-BLE build flag (`EXPO_PUBLIC_FAKE_BLE`) fits naturally in the `development`/`preview` env (see `ble-testing`).
- The iOS provisioning profile must include HealthKit. If EAS credentials were created before HealthKit was added, regenerate them.
- Test the **production** build on real devices before submitting. Some permission issues only appear in release builds (ProGuard/R8 stripping native classes; add the library's keep rules if you see `ClassNotFoundException`).

## Expo-specific libraries

| Need | Expo-friendly option |
|---|---|
| Keep screen awake during DFU/measurement | `expo-keep-awake` |
| Periodic background sync | `expo-background-task` (successor to `expo-background-fetch`) |
| Local outbox storage | `expo-sqlite` (with SQLCipher option) / `react-native-mmkv` |
| Secure tokens and keys | `expo-secure-store` |
| Notifications for FGS / reminders | `expo-notifications` (FGS itself still needs notifee or a custom module) |
