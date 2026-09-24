---
description: Set up Apple HealthKit and Android Health Connect in this React Native project behind one HealthStore interface, with validated BLE → health-store mapping and dedupe
argument-hint: "[data types, e.g. blood-pressure heart-rate glucose | read | write]"
---

Set up health-store integration. Data types and direction: $ARGUMENTS (if empty, ask which data types are **read** and which are **written**, because each one is a permission the user and the store reviewers will see).

Use the `health-data-integration` skill. Also use `expo-connected-health` if this is an Expo project, and `health-compliance` for consent and privacy wording.

1. **Inspect first and report before changing anything**: RN version, Expo (CNG or committed native folders) or bare, new architecture, TypeScript, iOS deployment target, Android `minSdkVersion`/`targetSdkVersion`, existing health or Google Fit code, and any existing BLE parsers (`healthParsers.ts`).
2. **Install**: `@kingstinct/react-native-healthkit` (iOS) and `react-native-health-connect` (Android). Use `npx expo install` on Expo. If an existing library is already in use, keep it unless the user wants to migrate. If Google Fit code exists, flag it as deprecated and propose a migration; don't delete it silently.
3. **Native configuration** (through config plugins on Expo):
   - iOS: HealthKit capability/entitlement, and specific `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` strings that name the data and the purpose. Enable background delivery only if it was asked for.
   - Android: one `android.permission.health.READ_*/WRITE_*` per type, the rationale intent filter + `activity-alias`, the `<queries>` entry, the `MainActivity` permission delegate, and `minSdkVersion` ≥ 26.
4. **Code** (follow the project's folder conventions, e.g. `src/health/`):
   - `healthMapping.ts`: copy from the skill's `assets/` together with its test file (adapted to the project's runner, as in `/ble-parser`).
   - `HealthStore.ts` interface + `healthKitStore.ts` + `healthConnectStore.ts`, following `references/platform-adapters.md`. **Before writing any library call, open the installed package's `.d.ts` files and match the real signatures.**
   - `index.ts` that picks the platform store, plus an in-memory `FakeHealthStore` for tests.
   - If BLE parsers exist: a function that takes a parsed reading, maps it (`mapBloodPressure`, ...), writes it to the local outbox, then calls `healthStore.write`.
5. **UX states**: health store unavailable (iPad, or Health Connect not installed / needs update, with a deep link to install), permission dialog, the "no data" state on iOS (never "permission denied" for reads), and write sharing turned off.
6. **Verify**: run the mapping tests and the type check. List the manual checks for each platform (write one sample of each type and confirm it in the Health app and in Health Connect with the correct unit, time and source, then write it again and confirm there's no duplicate).

Finish with a summary: files, permissions requested per platform, store-review items the user must complete (App Store privacy answers, Play Health Connect declaration, Data safety), and open questions.
