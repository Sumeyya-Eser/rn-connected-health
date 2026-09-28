---
name: health-compliance
description: Use when reviewing code or features of a React Native app that handles health data or talks to medical devices (e.g. "review this before launch", code that logs, stores, uploads or sends readings to analytics/crash reporting, or shows health alerts), and whenever the question is privacy, security or regulation — KVKK (Türkiye), GDPR special-category data, HIPAA, consent flows, data minimisation, encryption at rest, logging/crash-reporting of health data, account and data deletion, App Store 5.1.1/5.1.3 and Google Play health policies, or whether the app is medical device software (EU MDR, FDA SaMD, IEC 62304).
---

# Health data: privacy, security and regulatory checks

This skill gives **engineering checklists**, not legal advice. When a question needs a decision (Is this a medical device? Which lawful basis applies?), say so and point to the user's legal, DPO or regulatory contact. Never state that an app "is compliant".

## 1. Classify the app first

| Question | Why it matters |
|---|---|
| Does the app **interpret** readings (flags hypertension, suggests insulin doses, alerts on arrhythmia)? | Likely medical device software: EU MDR Rule 11 (usually class IIa or higher), FDA SaMD. Displaying and storing raw values is usually lower risk than interpreting them. |
| Is the connected device itself a medical device (CE / FDA-cleared BP monitor, glucose meter)? | The app can become an accessory or part of the device's system, depending on the manufacturer's intended use. |
| Who are the users: consumers, patients under a clinic's care, or clinicians? | Clinic context brings HIPAA (US covered entities / business associates) and hospital procurement requirements. |
| Where are the users and servers (TR, EU, US)? | KVKK, GDPR, HIPAA and state laws (e.g. Washington My Health My Data). |
| Is data sent to a backend, or does it stay on the phone and in HealthKit/HC? | Local-only apps have a much smaller compliance surface. |

**Wellness vs medical:** generic wellness claims ("track your heart rate during workouts") generally stay outside device regulation. Diagnosis, treatment or disease-management claims ("detect atrial fibrillation") bring it in. The **intended use and marketing claims** decide the classification, not the code. Check store listing text too.

## 2. Privacy law essentials

**KVKK (Türkiye)**
- Health data is *özel nitelikli kişisel veri* (special category). Since the 2024 amendment, processing is allowed under the conditions in Art. 6. For a typical consumer app that means **explicit consent** (*açık rıza*). Consent must be specific, informed and freely given, and can't be bundled with acceptance of the terms of service.
- Give an information notice (*aydınlatma metni*) separate from the consent text.
- Check whether VERBİS registration applies to the data controller.
- Cross-border transfer (for example to a cloud region outside Türkiye) follows Art. 9: an adequacy decision, standard contracts notified to the KVKK Authority, or other listed safeguards. Know where the backend, analytics and crash reporting store data.

**GDPR (EU/EEA)**
- Health data is Art. 9 special-category data. Consumer apps usually rely on explicit consent (Art. 9(2)(a)).
- Run a DPIA (Art. 35), which is normally required for large-scale health data processing.
- Provide data subject rights in-app: access/export, rectification, erasure, and withdrawing consent (which stops processing going forward).
- Put Data Processing Agreements in place with every processor (cloud, analytics, crash reporting, support tools).

**HIPAA (US)** applies only if the app is provided by or for a covered entity or business associate. If it applies: a BAA with every vendor touching PHI, audit logs, access controls and breach notification. A consumer app not offered through a provider is generally outside HIPAA, but FTC rules (Health Breach Notification Rule) and state laws still apply.

## 3. Engineering checklist

**Data minimisation**
- [ ] Request only the HealthKit / Health Connect types and BLE data the feature needs.
- [ ] Don't upload raw BLE captures or RR-interval streams unless a feature needs them.
- [ ] Set retention periods and implement deletion jobs.

**Consent and permissions**
- [ ] Consent screen before the first health data collection, with a separate checkbox for any secondary use (research, product improvement).
- [ ] Consent version and timestamp stored server-side; re-prompt when the purpose changes.
- [ ] Withdrawing consent is as easy as giving it (a settings toggle).
- [ ] OS permission prompts are preceded by an in-app explanation (pre-permission screen).

**Security**
- [ ] Local storage of readings is encrypted: SQLCipher / encrypted MMKV, with the key in the Keychain / Android Keystore (`expo-secure-store`, `react-native-keychain`). AsyncStorage is **plaintext**, so never use it for health data.
- [ ] iOS file protection is set deliberately (see `ble-background-sync` for background access).
- [ ] TLS everywhere. Consider certificate pinning for the health data API. Tokens go in secure storage, not AsyncStorage.
- [ ] **No health values in logs, analytics events or crash reports.** Scrub in Sentry `beforeSend` / Crashlytics, and don't log `console.log(reading)` in release builds. Log hex only behind a debug flag, and never with user identifiers.
- [ ] Analytics SDKs don't receive health-derived properties (for example a "has_hypertension" user property), which is also an App Store 5.1.3 issue.
- [ ] BLE: bond and use encrypted characteristics where the device supports it, and verify you're talking to the expected device (serial / manufacturer check) before trusting data.
- [ ] Backend: encryption at rest, access logging, least-privilege access for staff, and a separate environment for test data (no real patient data in dev).

**User rights and stores**
- [ ] In-app account deletion that deletes server data (App Store 5.1.1(v), Google Play account deletion requirement, with a web deletion link for Play).
- [ ] Data export in a readable format (GDPR portability).
- [ ] Privacy policy linked in-app and in the store listings, naming health data, purposes, processors and retention.
- [ ] Apple 5.1.3: no advertising or data-broker use of HealthKit data, no health data in iCloud, no false data written to HealthKit.
- [ ] Google Play: Health Connect declaration, the Health apps declaration form, and a Data safety form that matches the SDKs' real behaviour (analytics SDKs included).

## 4. Medical device software: what engineering should prepare

If the app is, or may become, medical device software:
- **IEC 62304** software lifecycle: software safety classification, requirements traceability, SOUP list (every npm dependency, native SDK and version), anomaly tracking, and a documented release process.
- **ISO 14971** risk management. Typical app hazards: wrong unit conversion, stale reading shown as current, missed reading after disconnect, wrong patient/user association (multi-user scales and BP user IDs), a notification not delivered.
- **IEC 62366** usability: summative testing for critical tasks.
- **Cybersecurity:** EU MDCG 2019-16, FDA premarket cybersecurity guidance (SBOM, threat model, patch plan).
- Change control: dependency upgrades and firmware updates are design changes (see `ble-firmware-update`).

The parsers (`healthParsers.ts`) and mapping (`healthMapping.ts`) in this plugin are tested but are **not validated medical software**. A regulated product needs its own verification against its requirements.

## 5. How to review a codebase

Use the `health-compliance-reviewer` agent or `/health-review`. Search for:
- `AsyncStorage`, `console.log`, `Sentry`, `crashlytics`, `analytics().logEvent`, `track(`, `mixpanel`, `amplitude`, `segment`: check what health data flows into them.
- `requestAuthorization`, `requestPermission`, `health.READ_`/`WRITE_`: check that the requested scope matches actual use.
- Deletion endpoints and in-app flows, consent storage, privacy policy links.
- `Info.plist` usage strings and the Android manifest health permissions and rationale.

Report findings as **risk + evidence (file:line) + suggested fix**, and mark which items need a legal or regulatory decision instead of a code change.
