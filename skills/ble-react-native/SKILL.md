---
name: ble-react-native
description: Use when writing, reviewing or debugging Bluetooth Low Energy code in a React Native app (react-native-ble-plx or similar) — scanning, connecting, permissions, GATT reads/writes/notifications, reconnection, background mode, parsing data from BLE health devices (heart rate, blood pressure, glucose, thermometer, weight scale, pulse oximeter, smart rings), or wrapping a manufacturer's native BLE SDK (vendor SDK, smart ring SDK) in a React Native app.
---

# BLE in React Native

Hard-won rules for BLE work in React Native. Follow these before writing code; most BLE bugs come from breaking one of them.

Section 10 has field lessons from production health-device apps. Read it whenever a manufacturer SDK or a non-SIG device is involved.

## 1. Library and single manager

- Default to `react-native-ble-plx`. Create **one** `BleManager` for the whole app (module singleton or context). Multiple managers cause duplicate callbacks and "operation was cancelled" errors.
- Wait for `PoweredOn` before scanning:
  ```ts
  const sub = manager.onStateChange((state) => {
    if (state === 'PoweredOn') { sub.remove(); startScan(); }
  }, true);
  ```
- Call `manager.destroy()` only on app teardown, never on screen unmount.

## 2. Permissions (the #1 source of "works on my phone" bugs)

**Android 12+ (API 31+)**
```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN"
    android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<!-- API 30 and below -->
<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />
```
- `neverForLocation` filters out some beacon advertisements. If the device is found by a scanner app but not yours, remove the flag and request location.
- Request at runtime based on `Platform.Version`: `BLUETOOTH_SCAN` + `BLUETOOTH_CONNECT` on 31+, `ACCESS_FINE_LOCATION` below. On API ≤ 30, Location Services must also be **on** or scans silently return nothing.

**iOS**
- `NSBluetoothAlwaysUsageDescription` in Info.plist (explain the device, e.g. "to read your blood pressure monitor"). Vague texts get App Review rejections.
- Background: add `bluetooth-central` to `UIBackgroundModes` only if you really need it, and justify it in review notes.

## 3. Scanning

- Always scan with service UUID filters when you know them — required for background scanning on iOS and saves battery everywhere.
- Android throttles apps that start scanning more than **5 times in 30 seconds**; the scan then silently returns no results. Debounce "scan" buttons and don't restart scans in a loop.
- Stop the scan before connecting (`manager.stopDeviceScan()`), and always stop it on a timeout.
- On iOS, `device.id` is a per-phone UUID, not the MAC address. Never persist it as a cross-device identifier; use a serial number from the Device Information Service (0x180A) instead.

## 4. Connecting and GATT operations

```ts
const device = await manager.connectToDevice(id, { timeout: 10000 });
await device.discoverAllServicesAndCharacteristics();
if (Platform.OS === 'android') await device.requestMTU(185);
```
- `discoverAllServicesAndCharacteristics()` is required before any read/write/monitor.
- MTU: Android defaults to 23 (20-byte payloads); request a larger one. iOS negotiates automatically — do not call `requestMTU` there.
- **Serialize GATT operations on Android.** Android's stack runs one operation at a time; parallel `Promise.all` of reads/writes fails randomly. Use a simple promise queue.
- Values are **base64** strings. Decode to bytes (`Buffer.from(value, 'base64')`) before parsing; never treat them as text.
- Write-with-response vs without: match the characteristic's properties (`isWritableWithResponse`). Wrong choice fails silently on some devices.

## 5. Notifications / monitoring

- Keep the `Subscription` returned by `monitorCharacteristicForDevice` and call `.remove()` when done. Leaked subscriptions keep firing after reconnect and cause duplicate readings.
- Error callback with `BleErrorCode.OperationCancelled` after disconnect is normal; don't show it to the user.
- Indications (e.g. Blood Pressure Measurement, Glucose Measurement) are handled the same way as notifications in ble-plx.

## 6. Disconnects and reconnection

- Subscribe to `device.onDisconnected` right after connecting.
- Reconnect with exponential backoff (e.g. 1s, 2s, 4s … max 30s) and a max-attempts cap. After reconnect, **re-discover services and re-subscribe** — subscriptions do not survive.
- Android GATT error 133 is generic: add a short delay, close, and retry; it often clears after 1–3 attempts. If it persists, check bonding state.
- iOS background restoration: pass `restoreStateIdentifier` and `restoreStateFunction` to `BleManager` if the app must keep a connection across app kills.

## 7. Bonding / pairing

- Many medical devices (glucose meters, some BP monitors) require bonding before encrypted characteristics can be read. On iOS the system pairing dialog appears on first access to an encrypted characteristic; on Android it may appear on connect or on first read.
- "Insufficient authentication" errors mean bonding is required.

## 8. Parsing Bluetooth SIG health profiles

- **Use `assets/healthParsers.ts` from this skill folder. Don't write parsers from scratch.** It is one dependency-free file with tests (`assets/healthParsers.test.ts`), and it covers heart rate, blood pressure, thermometer, weight, glucose + RACP and pulse oximetry, plus Device Information and battery. `parseCharacteristic(characteristic.uuid, characteristic.value)` takes ble-plx's UUID and base64 value directly.
- **Reference the assets, don't paste them.** When you can write files, copy `healthParsers.ts` / `gattQueue.ts` into the project unchanged. When you're answering in chat, write `import { parseGlucoseMeasurement, racp } from './healthParsers'`, tell the user to copy the file from this skill's `assets/`, and write only the new code around it. Never reproduce the asset's contents in the answer: it's long, already tested, and retyping it adds bugs.
- Read `references/health-profiles.md` for flag tables, units and the glucose RACP procedure.
- Byte 0 is a **flags** byte that decides which fields follow. Never assume fixed offsets.
- Values are IEEE-11073 **SFLOAT/FLOAT**, not integers. Special values (NaN, NRes, ±∞) must not reach the UI or health stores.
- Multi-byte fields are **little-endian**.
- Reject truncated payloads (`TruncatedPayloadError`) and log the hex (`bytesToHex`), never the user's values.

## 9. Testing

- Put the BLE layer behind an interface (`HealthDeviceService`) so the UI can be tested without hardware. The `ble-testing` skill has the fake device and Jest mocks.
- Use nRF Connect (iOS/Android) to check services, UUIDs and raw bytes before blaming your code. Save real captures as hex fixtures.
- Test on real devices on both platforms. Simulators and emulators have no BLE radio.

## 10. Vendor SDK devices: field lessons

These lessons come from shipping production health apps with smart rings and blood pressure monitors. Many consumer health devices come with a manufacturer's native SDK, often thinly documented, instead of Bluetooth SIG profiles or on top of them. Everything above still applies. These rules come on top of it.

- **The SDK is a second state layer.** A vendor SDK (for example a smart ring manufacturer's native SDK) keeps its own connection state, command sequence and on-device history. `connect → discover → monitor` doesn't describe the integration; the SDK's command/response sequence does. Wrap the SDK in a native module with a small promise-based API, and expose it through the same `HealthDeviceService` interface as your ble-plx devices so the UI doesn't care which kind it talks to.
- **Don't trust the SDK to fail fast.** Some SDK calls hang instead of returning an error. Put an explicit timeout on connect and on every command (about 10 s worked for the ring connection), then reset the SDK's connection state and fall back to a retry or a "move closer and try again" message. Don't wait indefinitely.
- **Device-side history must be cleared, but only after upload.** The ring kept measurements (HR, SpO₂, sleep, activity, HRV/stress, temperature, battery) until the app deleted them, and reading didn't clear them. The safe order is:
  1. Read a batch.
  2. Persist it locally.
  3. Upload it, and wait for success (2xx, and the upload must be idempotent).
  4. Delete exactly that data from the device.

  If you delete before the upload succeeds, a failed upload loses the data. If you never delete, every sync re-uploads the whole history. Deduplicate on the server anyway.
- **Numeric codes are vendor-specific.** One smart-ring SDK reported sleep stages as `1 = deep`, `2 = light`, `3 = REM`, `4 = awake`, `5 = nap`. Map codes like these into your own enum in **one** place, with a test, and handle unknown values explicitly. Never assume a code follows a Bluetooth SIG convention or another vendor's. When you write the data to a health store, decide deliberately what "nap" becomes, because neither HealthKit nor Health Connect has a nap stage.
- **Same category doesn't mean same protocol.** Within one product line of blood pressure monitors, one model needed different handling from the rest of the family. Choose protocol handling by **model**: advertised name, Device Information model number (0x2A24), or the vendor's model identifier. Keep a device registry (`model → protocol adapter + known quirks`), and add a test fixture per model, not per category.
- **Keep device acquisition separate from health-store sync.** The device layer produces normalized readings (`healthParsers.ts` for SIG devices, your adapter for vendor SDKs). The health-store layer (`health-data-integration`) consumes them. If vendor SDK callbacks write straight to HealthKit or Health Connect, both layers become untestable, and not every device's data should go to the OS health store anyway.
- **Document the raw mapping before you hide it.** For a poorly documented SDK or protocol, log the raw frames or SDK objects (debug builds only, with no user identifiers), write down each field's meaning and unit per model, and turn real captures into fixtures before building app-level models on top. The `ble-protocol-analyzer` agent and the `ble-testing` skill help with this.

## Related skills

- `ble-background-sync`: keeping connections and syncing while the app is in the background or killed (iOS state restoration, Android foreground service).
- `ble-testing`: mocks, fake peripherals, fixtures, E2E.
- `ble-firmware-update`: OTA/DFU (Nordic DFU, MCUmgr).
- `expo-connected-health`: Expo config plugins, dev client, prebuild.
- `health-data-integration`: writing parsed readings to HealthKit / Health Connect.
- `health-compliance`: privacy, security and regulatory checks for health data.
