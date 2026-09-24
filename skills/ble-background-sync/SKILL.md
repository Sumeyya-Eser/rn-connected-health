---
name: ble-background-sync
description: Use when a React Native health/BLE app must keep working while backgrounded, locked or killed — keeping a BLE connection alive, auto-reconnecting when a device comes back in range, receiving notifications in the background, iOS state restoration (bluetooth-central), Android foreground services (connectedDevice), Doze/battery optimisation, background fetch, or syncing readings to HealthKit / Health Connect / a backend in the background.
---

# Background BLE and sync in React Native

Background behaviour is where iOS and Android differ most. Decide first **which** of these the product actually needs, because each one has a different cost:

| Need | iOS | Android |
|---|---|---|
| A. Reading arrives while the app is open or recently backgrounded | nothing extra | nothing extra |
| B. Auto-sync when the device comes in range, app in background | `bluetooth-central` + pending connect | foreground service, or a companion device scan |
| C. Continuous streaming while the screen is off (e.g. HR during a workout) | `bluetooth-central` | foreground service (`connectedDevice`), required |
| D. Survive the OS killing the app | state restoration | foreground service + `START_STICKY`, only best effort |
| E. Periodic upload to backend / health store | BGTaskScheduler (via a library) | WorkManager (via a library) |

Nothing survives a **user** force-quit on iOS (swipe up), and on Android a force-stop has the same effect. Say this in the UI and in support docs.

## iOS

- Add `bluetooth-central` to `UIBackgroundModes`. Explain it in the App Review notes ("receives readings from the user's blood pressure monitor while the phone is locked"), or expect questions.
- **Background scanning only works with service UUID filters.** `allowDuplicates` is ignored, and scans run less often. A scan with `null` UUIDs returns nothing in the background.
- **Pending connect is the iOS auto-reconnect.** `connectToDevice(id)` *without a timeout* on a known peripheral stays pending indefinitely and completes when the device comes back in range, even in the background. This works better than scanning in a loop.
- **State restoration** (for need D): create the one `BleManager` with `restoreStateIdentifier` and `restoreStateFunction`. The manager must be created at app start, in module scope and not inside a component, because iOS relaunches the app in the background and delivers restored peripherals immediately.
  ```ts
  export const manager = new BleManager({
    restoreStateIdentifier: 'com.example.health.ble',
    restoreStateFunction: (restored) => {
      restored?.connectedPeripherals.forEach((d) => resumeDevice(d)); // re-discover + re-subscribe
    },
  });
  ```
- In the background you get roughly **10 seconds** of execution per BLE event. Parse, persist to local storage, and schedule upload. Don't do long network work inside the notification callback.
- The JS thread runs in the background only while iOS is delivering BLE events. Timers (`setTimeout`/`setInterval`) are unreliable there, so don't rely on them for reconnect logic. Use pending connects instead.

## Android

- Continuous background BLE needs a **foreground service** with a visible notification.
  - Android 14+ (targetSdk 34): declare `android:foregroundServiceType="connectedDevice"` on the service, plus `<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />` and `FOREGROUND_SERVICE_CONNECTED_DEVICE`. Starting the service also needs `BLUETOOTH_CONNECT` (or another connectedDevice prerequisite) to be granted *before* start, or the service throws `SecurityException`.
  - Android 13+: request `POST_NOTIFICATIONS`, otherwise the notification is hidden. The service still runs.
  - Android 12+: an app in the background **cannot start** a foreground service, apart from a few exemptions. Start it while the app is visible, for example when the user taps "Start measurement".
  - Library options: `@notifee/react-native` (foreground service support, pairs well with notifications) or `react-native-background-actions`. Check that it's maintained and supports the new architecture.
- **Doze / App Standby:** foreground services are exempt from most restrictions. Without one, BLE callbacks stop after a few minutes of screen-off. Asking users to disable battery optimisation (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) is restricted by Play policy, so only do it if you qualify.
- OEM battery killers (Xiaomi, Huawei, Samsung "sleeping apps") stop apps even with a foreground service. Link users to dontkillmyapp.com-style instructions from a help screen.
- **Companion Device Manager** (`CompanionDeviceManager`, API 26+, presence observing on 31+): the system wakes the app when an associated device appears. It's more battery-friendly than a constant foreground service for need B, but needs a native module.
- Headless JS lets code run without UI, but most BLE libraries expect the React context. Test cold-start paths explicitly.

## Periodic work and uploads (need E)

- Use `react-native-background-fetch` or `expo-background-task` (Expo). Both map to BGTaskScheduler on iOS and WorkManager on Android.
- The OS decides when these tasks run: from about every 15 minutes on Android down to rarely on iOS (it learns from usage). Never promise the user a fixed schedule.
- HealthKit: `enableBackgroundDelivery` wakes the app when **HealthKit** data changes. It doesn't react to BLE events. See the `health-data-integration` skill.
- Health Connect: background reads need `READ_HEALTH_DATA_IN_BACKGROUND` (a separate user grant).

## Data safety in the background

- **Persist first, sync later.** Write each parsed reading to a local outbox (SQLite / MMKV) in the BLE callback and upload or write to the health store from the outbox. Readings must survive the process dying mid-upload.
- The outbox key is the deterministic external ID from `healthMapping.ts`, so retries are idempotent.
- On iOS, if the device is locked, files with `NSFileProtectionComplete` aren't readable. Use `completeUntilFirstUserAuthentication` for the outbox, or background writes will fail.

## Checklist before shipping background BLE

- [ ] Background mode / FGS type declared, and justified in store review notes.
- [ ] `BleManager` created at module scope; restoration handler re-subscribes.
- [ ] Reconnect uses pending connect (iOS) or backoff in the service (Android). No `setInterval` scanning.
- [ ] Readings persisted before any network or health-store call.
- [ ] Tested: app backgrounded, screen locked for 30+ minutes, device out of range and back, app killed by the OS (Xcode "Simulate Background Fetch" / `adb shell am kill`), phone rebooted.
- [ ] Battery impact measured (Xcode Energy log, Android Battery Historian).
