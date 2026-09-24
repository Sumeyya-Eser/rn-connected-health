---
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
tags: [dfu]
---

Our React Native app (react-native-ble-plx) manages an nRF52-based blood pressure monitor that stores up to 100 readings. The firmware team gave us a Nordic Secure DFU zip. Write the update flow for the app: the steps, what to check before and after, and the TypeScript for the orchestration. Assume a DFU library exposes startDFU(deviceIdOrAddress, zipPath, onProgress).
