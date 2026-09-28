---
name: health-data-integration
description: Use when reading or writing health data in a React Native app via Apple HealthKit (iOS) or Android Health Connect, migrating away from the deprecated Google Fit APIs, mapping BLE device readings into health stores, or preparing a health app for App Store / Google Play review.
---

# HealthKit and Health Connect in React Native

## 1. Library choice

- **iOS:** `@kingstinct/react-native-healthkit` (typed, maintained, supports new architecture) or `react-native-health`. Check the library's latest release date and new-architecture support before choosing.
- **Android:** `react-native-health-connect`.
- **Google Fit:** its Android APIs are deprecated. Do not start new work on Google Fit; use Health Connect and plan migration for existing users.
- Put both behind one app-level interface (`HealthStore`) with shared types, so screens don't branch on platform.

## 2. iOS HealthKit setup

- Enable the HealthKit capability in Xcode (adds the entitlement). Enable "Clinical Health Records" only if you actually read clinical records — it triggers extra review.
- Info.plist:
  - `NSHealthShareUsageDescription` (read) and `NSHealthUpdateUsageDescription` (write). Be specific about which data and why.
- Request only the types you use. Asking for broad permissions is a common rejection reason.
- **Read permission is private:** HealthKit never tells you whether the user denied read access — denied reads simply return no data. Design empty states accordingly; do not show "permission denied" based on an empty query.
- Write authorization status *is* queryable.
- HealthKit is unavailable on some iPads (check `isHealthDataAvailable`).
- Background delivery (`enableBackgroundDelivery`) needs the HealthKit background delivery entitlement and an observer query registered at app launch.

## 3. Android Health Connect setup

- Health Connect is built into Android 14+. On Android 13 and below it's a separate app from Play Store — check SDK status (`getSdkStatus`) and send the user to install/update if needed.
- Declare each permission in AndroidManifest, e.g.:
  ```xml
  <uses-permission android:name="android.permission.health.READ_HEART_RATE" />
  <uses-permission android:name="android.permission.health.WRITE_BLOOD_PRESSURE" />
  ```
- Provide the privacy-policy / permissions-rationale activity that Health Connect links to (`androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE`, and on Android 14+ an `activity-alias` with `android.intent.action.VIEW_PERMISSION_USAGE` + `android.intent.category.HEALTH_PERMISSIONS`). Without it the permission dialog does not appear.
- By default only data from the last 30 days before the first grant is readable; older history needs `READ_HEALTH_DATA_HISTORY`. Background reads need `READ_HEALTH_DATA_IN_BACKGROUND`.
- Health Connect enforces rate limits; batch reads, use change tokens (`getChanges`) for incremental sync instead of re-reading everything.
- Google Play requires completing the Health Connect / health apps declaration in Play Console; access to each data type must be justified.

## 4. Mapping BLE readings to health stores

**Use `assets/healthMapping.ts` from this skill folder** (tests are in `assets/healthMapping.test.ts`). It turns a parsed BLE measurement into a validated `HealthSample` and then into plain HealthKit and Health Connect write descriptors. The platform adapter that calls the libraries stays thin. As with the parsers, import from it (`import { mapBloodPressure, toHealthKit } from './healthMapping'`) and tell the user to copy the file. Don't paste the whole file into a chat answer. Read `references/platform-adapters.md` for adapters, permissions and sync.

| BLE reading | HealthKit | Health Connect |
|---|---|---|
| Heart rate (bpm) | `HKQuantityTypeIdentifierHeartRate` (count/min) | `HeartRateRecord` (samples) |
| Blood pressure | `HKCorrelationTypeIdentifierBloodPressure` (systolic + diastolic, mmHg) | `BloodPressureRecord` |
| Body temperature | `HKQuantityTypeIdentifierBodyTemperature` (degC) | `BodyTemperatureRecord` |
| Blood glucose | `HKQuantityTypeIdentifierBloodGlucose` (mg/dL) | `BloodGlucoseRecord` (+ specimenSource, mealType, relationToMeal) |
| Weight | `HKQuantityTypeIdentifierBodyMass` (kg) | `WeightRecord` |
| SpO₂ | `HKQuantityTypeIdentifierOxygenSaturation` (**fraction 0–1**) | `OxygenSaturationRecord` (**percent**) |

- Convert units explicitly (kPa → mmHg, °F → °C, lb → kg). The parsers already expose normalized fields such as `systolicMmHg`, `celsius` and `kilograms`, so use those.
- **Validate before writing.** Plausibility ranges catch unit mix-ups (for example, 16/10.7 means kPa was treated as mmHg). Never write NaN, control-solution glucose or HR readings without sensor contact. Apple 5.1.3 forbids inaccurate data.
- Use the device timestamp from the payload when it's plausible. Otherwise fall back to receive time and record which one you used (`timeSource`).
- **Dedupe with a deterministic ID** made from the device serial, the kind, and the record key (glucose sequence number, otherwise the device timestamp):
  - HealthKit: `HKMetadataKeySyncIdentifier` + `HKMetadataKeySyncVersion`. Re-writing with the same identifier *replaces* the sample. `HKMetadataKeyExternalUUID` alone does not dedupe.
  - Health Connect: `metadata.clientRecordId` + `clientRecordVersion`. Re-inserting with the same id replaces the existing record instead of duplicating it. Bump `clientRecordVersion` when you correct a record.
- Attach device metadata (manufacturer, model, serial, firmware) from the Device Information Service.

## 4a. Sync strategy

- Persist each accepted reading locally **before** writing it to a health store or backend (an outbox pattern). Readings arrive once from BLE and can't be fetched again from many devices.
- Writes are idempotent because of the deterministic ID, so a retry after a crash or timeout is safe.
- Reading back: on iOS use anchored object queries (`HKAnchoredObjectQuery`). On Android use change tokens (`getChanges`). Don't re-read time ranges on every launch.
- Filter out your own writes when reading back (check the source bundle / `dataOrigin`) so you don't re-import them.

## 5. Store review checklist

Apple (App Review Guideline 5.1.3):
- [ ] Health data is not used for advertising or sold to data brokers.
- [ ] Personal health information is not stored in iCloud.
- [ ] No false or inaccurate data is written to HealthKit.
- [ ] Privacy policy URL is set and explains health data handling.
- [ ] Usage descriptions name the concrete data and purpose.
- [ ] Medical claims: if the app diagnoses or treats, expect regulatory documentation questions.

Google Play:
- [ ] Health Connect declaration completed, each permission justified.
- [ ] Data safety form matches actual collection.
- [ ] Privacy policy linked in-app and in the listing.
- [ ] Permissions-rationale activity implemented.

Also consider local regulation (e.g. KVKK in Türkiye, GDPR in the EU: health data is special-category data requiring explicit consent).

For privacy law, security and regulatory questions beyond store review, use the `health-compliance` skill.

## 6. Disclaimer

Remind the user that apps interpreting medical measurements may be regulated as medical device software (e.g. EU MDR, FDA). Do not present parsed values as diagnoses.
