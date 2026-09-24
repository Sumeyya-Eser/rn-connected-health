# Platform adapters: HealthKit and Health Connect

`assets/healthMapping.ts` produces plain write descriptors. The adapters below are the only code that touches the native libraries, so keep them thin.

> **Check signatures against the installed version before writing code.** Both libraries have changed their APIs between major versions. Examples: `requestAuthorization` in `@kingstinct/react-native-healthkit` changed from positional arguments to an object, and `saveQuantitySample` options moved. Read the package's `.d.ts` in `node_modules/` (for example `node_modules/@kingstinct/react-native-healthkit/**/*.d.ts` and `node_modules/react-native-health-connect/lib/typescript/**/*.d.ts`) and adapt the calls. The code below shows the **shape**, not a guaranteed signature.

## Shared interface

```ts
// health/HealthStore.ts
import type { HealthSample, SampleKind } from './healthMapping';

export type HealthStoreStatus = 'available' | 'notInstalled' | 'updateRequired' | 'unsupported';

export interface HealthStore {
  status(): Promise<HealthStoreStatus>;
  /** Returns true if the dialog was shown. Never infer *read* denial on iOS. */
  requestPermissions(kinds: { read: SampleKind[]; write: SampleKind[] }): Promise<boolean>;
  write(samples: HealthSample[]): Promise<{ written: number; failed: { sample: HealthSample; error: unknown }[] }>;
}

// health/index.ts
export const healthStore: HealthStore = Platform.OS === 'ios' ? healthKitStore : healthConnectStore;
```

Screens only import `healthStore`. Tests replace it with an in-memory fake.

## iOS: `@kingstinct/react-native-healthkit`

```ts
import * as HK from '@kingstinct/react-native-healthkit';
import { toHealthKit } from './healthMapping';

const HK_TYPES: Record<SampleKind, string[]> = {
  heartRate: ['HKQuantityTypeIdentifierHeartRate'],
  bloodPressure: ['HKQuantityTypeIdentifierBloodPressureSystolic', 'HKQuantityTypeIdentifierBloodPressureDiastolic'],
  bodyTemperature: ['HKQuantityTypeIdentifierBodyTemperature'],
  bloodGlucose: ['HKQuantityTypeIdentifierBloodGlucose'],
  weight: ['HKQuantityTypeIdentifierBodyMass'],
  oxygenSaturation: ['HKQuantityTypeIdentifierOxygenSaturation'],
};
// Blood pressure: authorize the systolic/diastolic quantity types. The correlation type itself
// cannot be requested for sharing.

export const healthKitStore: HealthStore = {
  async status() {
    return (await HK.isHealthDataAvailable()) ? 'available' : 'unsupported'; // false on some iPads
  },
  async requestPermissions({ read, write }) {
    // CHECK the installed signature: object form ({ toShare, toRead }) vs (read, write) positional.
    await HK.requestAuthorization({ toRead: read.flatMap((k) => HK_TYPES[k]), toShare: write.flatMap((k) => HK_TYPES[k]) });
    return true;
  },
  async write(samples) {
    const failed = [];
    for (const s of samples) {
      const d = toHealthKit(s);
      try {
        if (d.kind === 'quantity') {
          await HK.saveQuantitySample(d.identifier, d.unit, d.value, { start: d.start, end: d.end, metadata: d.metadata });
        } else {
          await HK.saveCorrelationSample(d.identifier, d.samples.map((q) => ({ quantityType: q.identifier, unit: q.unit, quantity: q.value })), { start: d.start, end: d.end, metadata: d.metadata });
        }
      } catch (error) {
        failed.push({ sample: s, error });
      }
    }
    return { written: samples.length - failed.length, failed };
  },
};
```

Notes:
- **Read denial is invisible.** An empty query result can mean either "no data" or "denied". The UI should say something like "No readings yet. Check Health → Sharing if you expected some" and never "Permission denied".
- Write authorization *is* queryable (`authorizationStatusFor`). Check it before writing and show a clear message if the user turned sharing off.
- Background delivery: call `enableBackgroundDelivery(type, frequency)` and register observer queries **at app launch** (in `index.js`, not inside a screen). This needs the `com.apple.developer.healthkit.background-delivery` entitlement.
- Metadata values must be strings, numbers, booleans or dates. Nested objects are rejected.

## Android: `react-native-health-connect`

```ts
import {
  initialize, getSdkStatus, SdkAvailabilityStatus, requestPermission, insertRecords, openHealthConnectSettings,
} from 'react-native-health-connect';
import { toHealthConnect } from './healthMapping';

const HC_RECORD: Record<SampleKind, string> = {
  heartRate: 'HeartRate',
  bloodPressure: 'BloodPressure',
  bodyTemperature: 'BodyTemperature',
  bloodGlucose: 'BloodGlucose',
  weight: 'Weight',
  oxygenSaturation: 'OxygenSaturation',
};

export const healthConnectStore: HealthStore = {
  async status() {
    const s = await getSdkStatus();
    if (s === SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (s === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'updateRequired';
    return 'notInstalled'; // Android ≤ 13 without the Health Connect app
  },
  async requestPermissions({ read, write }) {
    await initialize(); // must run before any other call
    await requestPermission([
      ...read.map((k) => ({ accessType: 'read' as const, recordType: HC_RECORD[k] })),
      ...write.map((k) => ({ accessType: 'write' as const, recordType: HC_RECORD[k] })),
    ]);
    return true;
  },
  async write(samples) {
    await initialize();
    try {
      await insertRecords(samples.map(toHealthConnect) as any); // one batch = one rate-limit unit
      return { written: samples.length, failed: [] };
    } catch (error) {
      return { written: 0, failed: samples.map((sample) => ({ sample, error })) };
    }
  },
};
```

Notes:
- `requestPermission` does nothing (it resolves with no dialog) when the manifest is missing the permission declarations or the rationale activity. That's the most common "it just doesn't work" report.
- Since library v2, `MainActivity` must register the permission delegate (`HealthConnectPermissionDelegate.setPermissionDelegate(this)` in `onCreate`). On Expo, the config plugin handles this.
- If the status is `notInstalled` or `updateRequired`, deep-link to the Play Store listing for `com.google.android.apps.healthdata`, or call `openHealthConnectSettings()`.
- Batch writes (up to about 1000 records per call) and back off on `RemoteException` / quota errors.
- `minSdkVersion` must be at least 26.

## Manifest and Info.plist snippets

```xml
<!-- AndroidManifest.xml: one line per record type you use -->
<uses-permission android:name="android.permission.health.WRITE_BLOOD_PRESSURE" />
<uses-permission android:name="android.permission.health.READ_BLOOD_PRESSURE" />

<!-- inside <application>: rationale screen (Android 13 and below) -->
<activity android:name=".MainActivity" ...>
  <intent-filter>
    <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
  </intent-filter>
</activity>
<!-- Android 14+ -->
<activity-alias
    android:name="ViewPermissionUsageActivity"
    android:exported="true"
    android:targetActivity=".MainActivity"
    android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
  <intent-filter>
    <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
    <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
  </intent-filter>
</activity-alias>

<queries>
  <package android:name="com.google.android.apps.healthdata" />
</queries>
```

The rationale intent must open a screen that shows your privacy policy. A blank activity fails Play review.

```xml
<!-- Info.plist -->
<key>NSHealthShareUsageDescription</key>
<string>Shows your blood pressure history from Apple Health next to readings from your monitor.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Saves blood pressure readings from your Bluetooth monitor to Apple Health.</string>
```

## Testing adapters

- Unit-test `healthMapping.ts`, which holds all the logic.
- Adapters can only be tested on a device, so keep a debug screen that writes one sample of each kind and reads it back.
- On iOS, the Health app → Browse → the data type → "Show All Data" shows your app's writes and their metadata.
- On Android, Health Connect → Data and access → the data type shows which app wrote each record.
