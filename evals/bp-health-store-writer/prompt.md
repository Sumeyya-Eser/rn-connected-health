---
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
tags: [bp]
---

Write a TypeScript function `saveBloodPressure(reading, device)` for my React Native app. It saves one blood pressure reading, already parsed from a BLE monitor, to Apple HealthKit (@kingstinct/react-native-healthkit) on iOS and Health Connect (react-native-health-connect) on Android. `reading` has systolic, diastolic, unit ('mmHg' | 'kPa'), an optional device timestamp and pulse. `device` has manufacturer, model and serial. The monitor re-sends its last reading on every reconnect, so the same reading may arrive several times. Give me complete code and don't ask questions.
