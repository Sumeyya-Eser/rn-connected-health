---
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
tags: [vendor]
---

Our blood pressure cuff doesn't use the Bluetooth SIG profile. It sends notifications on a vendor characteristic. Here are 4 captures from nRF Connect, with what the cuff's screen showed:

AA 09 01 78 00 50 48 00 1A  -> 120/80, pulse 72
AA 09 01 87 00 58 41 00 2A  -> 135/88, pulse 65
AA 09 01 76 00 4C 50 00 1C  -> 118/76, pulse 80
AA 09 01 8E 00 5B 65 01 59  -> 142/91, pulse 101, irregular heartbeat icon shown

Work out the frame format and write a TypeScript parser for it that we can use with react-native-ble-plx. Show your evidence.
