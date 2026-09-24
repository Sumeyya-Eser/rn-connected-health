# Bluetooth SIG health profiles: quick reference

Always check against the official Bluetooth SIG GATT Specification Supplement for the exact device, because manufacturers sometimes deviate from it.

**Code:** don't hand-write parsers. `assets/healthParsers.ts` in this skill folder is a tested, dependency-free implementation of everything below. It includes SFLOAT/FLOAT, Date Time, base64 decoding without `Buffer`, RACP commands, and a `parseCharacteristic(uuid, base64)` dispatcher. Its tests are in `assets/healthParsers.test.ts`. Copy it into the project, or adapt it with `/ble-parser`.

| Profile | Service | Measurement characteristic | Value type | Notify/Indicate |
|---|---|---|---|---|
| Heart Rate | 0x180D | Heart Rate Measurement 0x2A37 | uint8 / uint16 | Notify |
| Blood Pressure | 0x1810 | Blood Pressure Measurement 0x2A35 (+ Intermediate Cuff Pressure 0x2A36) | SFLOAT | Indicate (0x2A36: Notify) |
| Health Thermometer | 0x1809 | Temperature Measurement 0x2A1C (+ Intermediate 0x2A1E) | FLOAT (32-bit) | Indicate (0x2A1E: Notify) |
| Glucose | 0x1808 | Glucose Measurement 0x2A18, Context 0x2A34, RACP 0x2A52 | SFLOAT | Notify (RACP: Indicate) |
| Weight Scale | 0x181D | Weight Measurement 0x2A9D | uint16 × resolution | Indicate |
| Pulse Oximeter | 0x1822 | PLX Spot-Check 0x2A5E / Continuous 0x2A5F | SFLOAT | Indicate / Notify |
| Device Information | 0x180A | Model 0x2A24, Serial 0x2A25, Firmware 0x2A26, Manufacturer 0x2A29 | UTF-8 | Read |
| Battery | 0x180F | Battery Level 0x2A19 | uint8 (%) | Read / Notify |
| Current Time | 0x1805 | Current Time 0x2A2B | Date Time + day + fractions + reason | Read / Write / Notify |

The full 128-bit form is `0000XXXX-0000-1000-8000-00805f9b34fb`. ble-plx returns lowercase 128-bit UUIDs, so compare in lowercase (`shortUuid()` does this).

## Encoding basics

- Multi-byte fields are **little-endian**.
- Byte 0 of every measurement is a **flags** byte. Optional fields appear **in flag-bit order** and only when their bit is set. Never use fixed offsets.
- **SFLOAT (16-bit):** 4-bit signed exponent and 12-bit signed mantissa, so value = mantissa × 10^exponent. The special raw values are `0x07FF` NaN, `0x0800` NRes, `0x07FE` +∞, `0x0802` −∞ and `0x0801` reserved.
- **FLOAT (32-bit):** 8-bit signed exponent and 24-bit signed mantissa. The special mantissas are `0x7FFFFF` NaN, `0x800000` NRes, `0x7FFFFE` +∞ and `0x800002` −∞.
- **Date Time (7 bytes):** year uint16, then month, day, hours, minutes and seconds. A year, month or day of 0 means *unknown*. There's **no time zone**, so the value is the device clock's wall time.
- Compute negative exponents as `m / 10^n`, not `m * 10^-n`, so 36.6 doesn't come out as 36.60000000000001.

## Heart Rate Measurement (0x2A37)

| Flag bit | Meaning | Field that follows |
|---|---|---|
| 0 | HR format: 0 = uint8, 1 = uint16 | HR value |
| 1 | Sensor contact detected | none |
| 2 | Sensor contact supported (if 0, ignore bit 1) | none |
| 3 | Energy expended present | uint16, kJ |
| 4 | RR intervals present | uint16 × n, unit 1/1024 s |

A single notification can carry several RR intervals, so read until the payload ends.

## Blood Pressure Measurement (0x2A35) / Intermediate Cuff Pressure (0x2A36)

| Flag bit | Meaning | Field |
|---|---|---|
| 0 | Unit: 0 = mmHg, 1 = kPa (1 kPa = 7.50062 mmHg) | none |
| 1 | Timestamp | Date Time (7) |
| 2 | Pulse rate | SFLOAT, bpm |
| 3 | User ID | uint8 (0xFF = unknown) |
| 4 | Measurement status | uint16 |

The mandatory fields come first: systolic, diastolic and MAP (each an SFLOAT). The optional fields follow in the order above. In 0x2A36, only the first value (current cuff pressure) is meaningful and the other two are NaN.
The status bits are: 0 body movement, 1 cuff too loose, 2 irregular pulse, 3–4 pulse-rate range (0 within, 1 above, 2 below), 5 improper position. Show them in the UI, because users should retake a reading when they're set.

## Temperature Measurement (0x2A1C)

Flag bits: 0 unit (0 = °C, 1 = °F), 1 timestamp, 2 temperature type (uint8). The value is a FLOAT right after the flags.
Types: 1 armpit, 2 body, 3 ear, 4 finger, 5 GI tract, 6 mouth, 7 rectum, 8 toe, 9 tympanum.

## Weight Measurement (0x2A9D)

| Flag bit | Meaning | Field |
|---|---|---|
| 0 | Unit: 0 = SI (0.005 kg resolution), 1 = imperial (0.01 lb resolution) | none |
| 1 | Timestamp | Date Time |
| 2 | User ID | uint8 (0xFF = unknown) |
| 3 | BMI and height | BMI uint16 × 0.1, height uint16 (SI: 0.001 m, imperial: 0.1 in) |

A weight of `0xFFFF` means "measurement unsuccessful". Many scales send several indications while the value stabilises, so only store the final one (the one with the timestamp, or the last one before the scale disconnects).

## Glucose (0x2A18 + 0x2A34 + RACP 0x2A52)

Glucose Measurement layout: flags, sequence number (uint16), base time (Date Time), then the optional fields.

| Flag bit | Meaning | Field |
|---|---|---|
| 0 | Time offset | sint16, minutes (add it to base time) |
| 1 | Concentration + type/sample location | SFLOAT, then a uint8 (low nibble = type, high nibble = location) |
| 2 | Concentration unit: 0 = kg/L, 1 = mol/L | none |
| 3 | Sensor status annunciation | uint16 |
| 4 | Context information follows (0x2A34 with the same sequence number) | none |

- Unit conversion: kg/L × 100 000 = mg/dL, and mol/L × 1000 = mmol/L. 1 mmol/L equals 18.016 mg/dL.
- **Control-solution** readings (type 10 or location 4) are meter checks, not the user's glucose. Never write them to a health store.
- The meter doesn't push its records unprompted. The app requests them through RACP:
  1. Bond first. Most meters require encryption.
  2. Subscribe to 0x2A18 (and to 0x2A34 if you need meal/context data).
  3. Enable **indications** on RACP 0x2A52.
  4. Write `[0x01, 0x01]` to fetch all records, or `[0x01, 0x03, 0x01, seqLo, seqHi]` to fetch records with sequence ≥ N for incremental sync. Persist the last sequence number per meter serial.
  5. Records arrive as notifications. The procedure ends with an RACP indication `[0x06, 0x00, requestOpCode, responseCode]`, where response code 1 means success and 6 means no records found.
  - `[0x04, 0x01]` asks for the record count, which is answered with `[0x05, 0x00, countLo, countHi]`. Use it to show progress.
- Write RACP with response and allow at least 30 s for the procedure. Old meters are slow.

## Pulse Oximeter (0x1822)

**PLX Spot-Check (0x2A5E):** flags, SpO₂ (SFLOAT, %), PR (SFLOAT, bpm), then:
bit 0 timestamp, bit 1 measurement status (uint16), bit 2 device & sensor status (uint24), bit 3 pulse amplitude index (SFLOAT), bit 4 *device clock is not set* (if set, ignore the timestamp).

**PLX Continuous (0x2A5F):** flags, SpO₂/PR normal (2 × SFLOAT), then:
bit 0 SpO₂/PR fast (2 × SFLOAT), bit 1 SpO₂/PR slow (2 × SFLOAT), bit 2 measurement status, bit 3 device & sensor status (uint24), bit 4 PAI.

Continuous mode streams at about 1 Hz. Downsample or aggregate before writing to health stores.

## Vendor (non-SIG) protocols

Many consumer devices use a proprietary service instead of, or alongside, the SIG profiles. A common example is Nordic UART `6e400001-b5a3-f393-e0a9-e50e24dcca9e`. For those devices, use the `ble-protocol-analyzer` agent to work out the frame format from captures, then write a parser in the same style (a `ByteReader`, fixtures and tests).
