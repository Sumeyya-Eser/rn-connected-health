---
name: ble-testing
description: Use when testing BLE or health-data code in a React Native app without (or with) real hardware — unit-testing parsers with captured fixtures, mocking react-native-ble-plx in Jest, building a fake health device / simulated peripheral, testing reconnect and error paths, E2E tests (Detox, Maestro) for BLE flows, or setting up a hardware test bench (nRF52 DK, nRF Connect GATT server).
---

# Testing BLE and health integrations

BLE bugs hide in edge cases: truncated packets, reconnects, duplicate notifications, unit flags. Real devices rarely produce those on demand, so layer the tests:

| Layer | What | Tool | Runs in CI |
|---|---|---|---|
| 1. Parsers | bytes → values, every flag combination, special values, truncation | Jest + hex fixtures | yes |
| 2. Mapping | values → HealthKit/HC descriptors, plausibility, dedupe IDs | Jest | yes |
| 3. Service logic | connect/discover/subscribe/reconnect/RACP state machines | Jest + `jest.mock('react-native-ble-plx')` | yes |
| 4. UI flows | pairing screens, empty states, error messages | Jest + React Native Testing Library, with a fake `HealthDeviceService` | yes |
| 5. E2E | full app on a simulator/emulator with a fake device service | Detox / Maestro + build flag | yes (no radio needed) |
| 6. Hardware | real radio, real timing, bonding, background | nRF52 DK / phone as peripheral / the real device | manual or nightly |

## 1. Parser tests with real captures

- Capture real payloads in nRF Connect (enable notifications and copy the hex from the log), together with what the device's own display showed. Store them as fixtures:
  ```ts
  // __fixtures__/bp-monitor.ts: captured <date> from <model, firmware>; device display showed 128/84, pulse 71
  export const BP_MONITOR_1 = { hex: '1e 80 00 54 00 60 00 ea 07 09 18 0e 1e 05 47 00 01 00 00', expected: { sys: 128, dia: 84, pulse: 71 } };
  ```
- Use `hexToBytes`, `sfloatBytes`, `floatBytes` and `dateTimeBytes` from `healthParsers.ts` (`ble-react-native` skill assets) to build synthetic cases for flag combinations the device never sends.
- Every parser needs tests for: minimum payload (all flags 0), all flags set, each special value (NaN / NRes / ±∞ / 0xFFFF), and a truncated payload that must throw.
- Parsers are pure functions, so this is where most coverage should come from.

## 2. Mapping tests

`healthMapping.test.ts` in the `health-data-integration` skill assets is the template. Cover SpO₂ fraction vs percent, kPa values passed as mmHg (must be rejected), control-solution glucose, future device timestamps, and deterministic dedupe IDs.

## 3. Mocking react-native-ble-plx

Mock the module once in `jest.setup.js` / `__mocks__/react-native-ble-plx.ts` so no test touches native code:

```ts
// __mocks__/react-native-ble-plx.ts
export const State = { PoweredOn: 'PoweredOn', PoweredOff: 'PoweredOff', Unauthorized: 'Unauthorized' };
export const BleErrorCode = { OperationCancelled: 2, DeviceDisconnected: 201 };

type Listener = (error: unknown, characteristic: { uuid: string; value: string } | null) => void;

export class BleManager {
  static instances = 0;
  monitors = new Map<string, Listener>();
  disconnectListeners = new Set<(e: unknown, d: unknown) => void>();
  constructor() { BleManager.instances++; } // assert === 1 to catch "multiple managers" bugs
  onStateChange = jest.fn((cb: (s: string) => void, emitCurrent?: boolean) => {
    if (emitCurrent) cb(State.PoweredOn);
    return { remove: jest.fn() };
  });
  startDeviceScan = jest.fn();
  stopDeviceScan = jest.fn();
  connectToDevice = jest.fn(async (id: string) => this.device(id));
  cancelDeviceConnection = jest.fn(async (id: string) => this.device(id));
  destroy = jest.fn();

  device(id: string) {
    return {
      id,
      discoverAllServicesAndCharacteristics: jest.fn(async function (this: unknown) { return this; }),
      requestMTU: jest.fn(async function (this: unknown) { return this; }),
      onDisconnected: jest.fn((cb) => { this.disconnectListeners.add(cb); return { remove: () => this.disconnectListeners.delete(cb) }; }),
      monitorCharacteristicForService: jest.fn((_s: string, c: string, cb: Listener) => {
        this.monitors.set(c.toLowerCase(), cb);
        return { remove: () => this.monitors.delete(c.toLowerCase()) };
      }),
      readCharacteristicForService: jest.fn(),
      writeCharacteristicWithResponseForService: jest.fn(),
    };
  }

  // test helpers
  emit(characteristicUuid: string, base64: string) { this.monitors.get(characteristicUuid.toLowerCase())?.(null, { uuid: characteristicUuid, value: base64 }); }
  disconnect() { this.disconnectListeners.forEach((cb) => cb(null, {})); }
}
```

Then test the behaviour that breaks in production:
- **Duplicate readings:** emit, disconnect, reconnect, emit again, and assert the handler ran exactly twice (no leaked subscription).
- **Re-subscribe after reconnect:** after `disconnect()` plus a reconnect, `monitors` must contain the characteristic again.
- **Backoff:** use `jest.useFakeTimers()` and check the delays against `reconnectDelayMs`, and that it gives up after max attempts.
- **Queue:** assert that reads/writes never overlap (see `gattQueue.test.ts` in the `ble-react-native` assets).
- **Glucose RACP:** emit N records, then the RACP success indication. Assert completion, and assert that the last sequence number was persisted.
- **Singleton:** `BleManager.instances === 1` after rendering the whole app.

## 4–5. Fake device service for UI and E2E

The app should depend on an interface, not on ble-plx:

```ts
export interface HealthDeviceService {
  scan(onFound: (d: FoundDevice) => void): () => void;       // returns stop()
  connect(id: string): Promise<ConnectedDevice>;
  readings$: Observable<ParsedReading> | ((cb: (r: ParsedReading) => void) => () => void);
  state$: (cb: (s: 'idle' | 'scanning' | 'connecting' | 'connected' | 'reconnecting' | 'error') => void) => () => void;
}
```

A `FakeHealthDeviceService` scripts scenarios (a normal reading, a slow connect, disconnect mid-transfer, a bonding error, a kPa-unit device, a control-solution glucose). Select it with a build flag (`EXPO_PUBLIC_FAKE_BLE=1` / `react-native-config`) so Detox or Maestro can drive complete flows on simulators that have no Bluetooth. Include a hidden debug menu to trigger scenarios by hand.

## 6. Hardware test bench

- **Peripheral simulators:** nRF Connect for Mobile has a GATT server mode on Android (configure the Heart Rate, BP or Glucose services on a second phone). A **Nordic nRF52 DK** running the SDK's sample profiles (`peripheral/hrs`, `bps`, `gls`) behaves like a real device, including bonding.
- On a laptop, `@abandonware/bleno` (Node) can advertise a custom GATT server. It's good for vendor protocols, but check platform support first.
- Keep a **device matrix**: at least one older Android (API 26–30, location-based permissions), a current Android, a Samsung, and an older plus a current iPhone.
- Log raw hex (not decoded health values) behind a debug flag so field reports can be turned into fixtures.

## Coverage priorities

1. Parsers and mapping at close to 100 %, because they're cheap and catch unit errors.
2. Reconnect and subscription lifecycle, where most production bugs are.
3. Permission flows per Android API level (mock `PermissionsAndroid` and `Platform.Version`).
4. Everything else as needed.
