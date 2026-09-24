---
description: Add a tested parser for a BLE characteristic to this project — a Bluetooth SIG health profile or a vendor protocol described by sample payloads
argument-hint: "[SIG characteristic (e.g. 0x2A35, blood-pressure) | vendor + sample hex payloads]"
---

Add a parser for: $ARGUMENTS (if empty, ask which characteristic, or ask for sample payloads with the values the device displayed).

Use the `ble-react-native` skill. The reference implementation is `assets/healthParsers.ts` in that skill folder, with its tests in `assets/healthParsers.test.ts`.

1. **Inspect the project**: TypeScript or JS, test runner (Jest / Vitest / none), folder conventions, and whether `healthParsers.ts` (or another parser module) already exists. If one exists, extend it rather than adding a second.
2. **SIG characteristic** (0x2A37, 0x2A35, 0x2A1C, 0x2A9D, 0x2A18/0x2A52, 0x2A5E/0x2A5F, DIS, battery):
   - Copy `healthParsers.ts` into the project's BLE folder (e.g. `src/ble/healthParsers.ts`). Keep it as one file with no dependencies. It already covers every profile, so don't strip it down unless the user asks.
   - Adapt the test file to the project's runner. For Jest: remove the `node:test` / `node:assert` imports, use `expect(x).toEqual(y)` / `toBe` / `toThrow`, and import from `./healthParsers` without the `.ts` extension. Keep every test case.
   - If the user gave real captures, add them as fixtures with their expected values and a comment naming the device model, firmware and capture date.
3. **Vendor protocol** (no SIG UUID):
   - Delegate the decoding to the `ble-protocol-analyzer` agent, passing the payloads and known values.
   - Write the parser in the same style: a `ByteReader`, a typed result, `TruncatedPayloadError` on short input, and a checksum check if the protocol has one. Also write tests from the captures and label any field that's still a hypothesis.
4. **Wire it in** only if the user wants that: show where `parseCharacteristic(characteristic.uuid, characteristic.value)` goes in the monitor callback, and how NaN or rejected values are handled (not shown to the user as readings).
5. **Run the tests** and report the results. If there's no test runner, say so and offer the zero-dependency command `node --experimental-strip-types --test <file>` (Node 22.6+) as a stopgap.

Finish with: files added or changed, test results, and fields that need confirmation on real hardware.
