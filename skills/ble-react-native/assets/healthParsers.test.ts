// Runs with zero dependencies: node --experimental-strip-types --test healthParsers.test.ts
// In a React Native project, swap the imports for Jest globals (describe/it/expect) — see /ble-parser.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ToBytes,
  bytesToBase64,
  dateTimeBytes,
  decodeUtf8,
  floatBytes,
  floatFromRaw,
  hexToBytes,
  parseBloodPressureMeasurement,
  parseCharacteristic,
  parseGlucoseMeasurement,
  parseHeartRateMeasurement,
  parsePlxContinuous,
  parsePlxSpotCheck,
  parseRacpResponse,
  parseTemperatureMeasurement,
  parseWeightMeasurement,
  racp,
  sfloatBytes,
  sfloatFromRaw,
  shortUuid,
  toFullUuid,
  TruncatedPayloadError,
} from './healthParsers.ts';

const bytes = (...parts: (number | number[])[]) => Uint8Array.from(parts.flat());
const TS = new Date(2026, 8, 24, 14, 30, 5); // 2026-09-24 14:30:05 local

describe('base64 / hex / utf8', () => {
  it('round-trips base64 for every length mod 3', () => {
    for (const hex of ['', '16', '16 48', '16 48 00', '16 48 00 10 04', 'ff 00 7f 80 01 fe']) {
      const b = hexToBytes(hex);
      assert.deepEqual(base64ToBytes(bytesToBase64(b)), b);
    }
  });
  it('decodes a known base64 value', () => {
    assert.deepEqual(base64ToBytes('FkgAEAQ='), hexToBytes('16 48 00 10 04'));
  });
  it('accepts 0x-prefixed and dash-separated hex', () => {
    assert.deepEqual(hexToBytes('0x16 0x48'), bytes(0x16, 0x48));
    assert.deepEqual(hexToBytes('16-48'), bytes(0x16, 0x48));
  });
  it('decodes UTF-8 and strips trailing NULs', () => {
    assert.equal(decodeUtf8(bytes([0x53, 0x4e, 0x2d, 0x31, 0x00, 0x00])), 'SN-1');
    assert.equal(decodeUtf8(bytes([0xc3, 0xbc])), 'ü');
  });
});

describe('UUIDs', () => {
  it('converts between short and full SIG UUIDs', () => {
    assert.equal(toFullUuid(0x2a37), '00002a37-0000-1000-8000-00805f9b34fb');
    assert.equal(shortUuid('00002A37-0000-1000-8000-00805F9B34FB'), 0x2a37);
    assert.equal(shortUuid('2a37'), 0x2a37);
    assert.equal(shortUuid('6e400001-b5a3-f393-e0a9-e50e24dcca9e'), undefined);
  });
});

describe('IEEE-11073', () => {
  it('parses SFLOAT including negative exponents without float noise', () => {
    assert.equal(sfloatFromRaw(0x0078), 120);
    assert.equal(sfloatFromRaw(0xf16e), 36.6);
    assert.equal(sfloatFromRaw(0xc037), 0.0055);
    assert.equal(sfloatFromRaw(0x0fff), -1);
    assert.equal(sfloatFromRaw(0x1001), 10);
  });
  it('maps SFLOAT special values', () => {
    assert.ok(Number.isNaN(sfloatFromRaw(0x07ff)));
    assert.ok(Number.isNaN(sfloatFromRaw(0x0800)));
    assert.equal(sfloatFromRaw(0x07fe), Infinity);
    assert.equal(sfloatFromRaw(0x0802), -Infinity);
  });
  it('parses FLOAT and its special values', () => {
    assert.equal(floatFromRaw(0xff00016e), 36.6);
    assert.ok(Number.isNaN(floatFromRaw(0x007fffff)));
    assert.equal(floatFromRaw(0x007ffffe), Infinity);
  });
  it('encoders round-trip', () => {
    for (const [v, d] of [[120, 0], [36.6, 1], [-12.5, 1], [0.0055, 4]] as const) {
      const [lo, hi] = sfloatBytes(v, d);
      assert.equal(sfloatFromRaw(lo | (hi << 8)), v);
      const f = floatBytes(v, d);
      assert.equal(floatFromRaw((f[0] | (f[1] << 8) | (f[2] << 16) | (f[3] << 24)) >>> 0), v);
    }
    assert.throws(() => sfloatBytes(3000), RangeError);
  });
});

describe('Heart Rate Measurement 0x2A37', () => {
  it('parses uint8 bpm, contact and RR intervals', () => {
    const hr = parseHeartRateMeasurement(hexToBytes('16 48 00 04'));
    assert.deepEqual(hr, { bpm: 72, sensorContact: true, energyExpendedKJ: undefined, rrIntervalsMs: [1000] });
  });
  it('parses uint16 bpm and energy expended; contact undefined when unsupported', () => {
    const hr = parseHeartRateMeasurement(bytes(0x09, [0x2c, 0x01], [0x10, 0x00]));
    assert.equal(hr.bpm, 300);
    assert.equal(hr.energyExpendedKJ, 16);
    assert.equal(hr.sensorContact, undefined);
  });
  it('reports sensor contact lost', () => {
    assert.equal(parseHeartRateMeasurement(bytes(0x04, 60)).sensorContact, false);
  });
});

describe('Blood Pressure Measurement 0x2A35', () => {
  it('parses mmHg with timestamp, pulse, user and status', () => {
    const bp = parseBloodPressureMeasurement(
      bytes(0x1e, sfloatBytes(120), sfloatBytes(80), sfloatBytes(93), dateTimeBytes(TS), sfloatBytes(72), 0x01, [0x04, 0x00]),
    );
    assert.equal(bp.unit, 'mmHg');
    assert.equal(bp.systolicMmHg, 120);
    assert.equal(bp.diastolicMmHg, 80);
    assert.equal(bp.meanArterialPressure, 93);
    assert.deepEqual(bp.timestamp, TS);
    assert.equal(bp.pulseRate, 72);
    assert.equal(bp.userId, 1);
    assert.equal(bp.status?.irregularPulse, true);
    assert.equal(bp.status?.bodyMovement, false);
    assert.equal(bp.status?.pulseRateRange, 'within');
  });
  it('converts kPa to mmHg', () => {
    const bp = parseBloodPressureMeasurement(bytes(0x01, sfloatBytes(16, 0), sfloatBytes(10.7, 1), sfloatBytes(12.4, 1)));
    assert.equal(bp.unit, 'kPa');
    assert.equal(bp.systolic, 16);
    assert.equal(bp.systolicMmHg, 120);
    assert.equal(bp.diastolicMmHg, 80.3);
    assert.equal(bp.timestamp, undefined);
  });
  it('throws a descriptive error on a truncated payload', () => {
    assert.throws(() => parseBloodPressureMeasurement(bytes(0x02, sfloatBytes(120), sfloatBytes(80), sfloatBytes(93), 0xea)), TruncatedPayloadError);
  });
});

describe('Temperature Measurement 0x2A1C', () => {
  it('parses Celsius with type', () => {
    const t = parseTemperatureMeasurement(bytes(0x04, floatBytes(36.6, 1), 0x03));
    assert.deepEqual(t, { unit: 'C', value: 36.6, celsius: 36.6, timestamp: undefined, type: 'ear' });
  });
  it('converts Fahrenheit and reads the timestamp', () => {
    const t = parseTemperatureMeasurement(bytes(0x03, floatBytes(98.6, 1), dateTimeBytes(TS)));
    assert.equal(t.celsius, 37);
    assert.deepEqual(t.timestamp, TS);
  });
});

describe('Weight Measurement 0x2A9D', () => {
  it('parses SI weight (0.005 kg resolution) with BMI and height', () => {
    const w = parseWeightMeasurement(bytes(0x08, [0x2c, 0x3a], [0xdb, 0x00], [0xda, 0x06]));
    assert.equal(w.unit, 'kg');
    assert.equal(w.weight, 74.46); // 0x3a2c = 14892 × 0.005
    assert.equal(w.bmi, 21.9);
    assert.equal(w.height, 1.754);
  });
  it('parses imperial weight and converts to kg', () => {
    const w = parseWeightMeasurement(bytes(0x01, [0x3c, 0x41])); // 16700 × 0.01 lb
    assert.equal(w.weight, 167);
    assert.equal(w.kilograms, 75.75);
  });
  it('maps 0xFFFF to NaN (measurement unsuccessful)', () => {
    assert.ok(Number.isNaN(parseWeightMeasurement(bytes(0x00, [0xff, 0xff])).weight));
  });
});

describe('Glucose Measurement 0x2A18', () => {
  it('parses kg/L with time offset and sample type/location', () => {
    const g = parseGlucoseMeasurement(
      bytes(0x03, [0x2a, 0x00], dateTimeBytes(TS), [0xf6, 0xff], sfloatBytes(0.00095, 5), 0x11),
    );
    assert.equal(g.sequenceNumber, 42);
    assert.equal(g.timeOffsetMinutes, -10);
    assert.deepEqual(g.timestamp, new Date(2026, 8, 24, 14, 20, 5));
    assert.equal(g.mgPerDl, 95);
    assert.equal(g.mmolPerL, 5.27);
    assert.equal(g.sampleType, 'capillaryWholeBlood');
    assert.equal(g.sampleLocation, 'finger');
    assert.equal(g.isControlSolution, false);
  });
  it('parses mol/L and flags control solution', () => {
    const g = parseGlucoseMeasurement(bytes(0x16, [0x01, 0x00], dateTimeBytes(TS), sfloatBytes(0.0055, 4), 0x4a));
    assert.equal(g.mmolPerL, 5.5);
    assert.equal(g.mgPerDl, 99.1);
    assert.equal(g.isControlSolution, true);
    assert.equal(g.contextFollows, true);
  });
  it('builds RACP commands and parses responses', () => {
    assert.deepEqual(racp.reportAllRecords(), bytes(0x01, 0x01));
    assert.deepEqual(racp.reportRecordsFrom(0x0102), bytes(0x01, 0x03, 0x01, 0x02, 0x01));
    assert.deepEqual(parseRacpResponse(bytes(0x05, 0x00, 0x0c, 0x00)), { kind: 'numberOfRecords', count: 12 });
    assert.deepEqual(parseRacpResponse(bytes(0x06, 0x00, 0x01, 0x06)), {
      kind: 'responseCode',
      requestOpCode: 1,
      code: 6,
      success: false,
      message: 'no records found',
    });
  });
});

describe('Pulse oximeter', () => {
  it('parses spot-check with timestamp', () => {
    const p = parsePlxSpotCheck(bytes(0x01, sfloatBytes(98), sfloatBytes(64), dateTimeBytes(TS)));
    assert.equal(p.spo2, 98);
    assert.equal(p.pulseRate, 64);
    assert.deepEqual(p.timestamp, TS);
  });
  it('drops the timestamp when the device clock is not set', () => {
    const p = parsePlxSpotCheck(bytes(0x11, sfloatBytes(98), sfloatBytes(64), dateTimeBytes(TS)));
    assert.equal(p.timestamp, undefined);
    assert.equal(p.deviceClockNotSet, true);
  });
  it('parses continuous with fast values and PAI', () => {
    const p = parsePlxContinuous(bytes(0x11, sfloatBytes(97), sfloatBytes(70), sfloatBytes(96), sfloatBytes(72), sfloatBytes(2.5, 1)));
    assert.deepEqual(p.fast, { spo2: 96, pulseRate: 72 });
    assert.equal(p.slow, undefined);
    assert.equal(p.pulseAmplitudeIndex, 2.5);
  });
});

describe('parseCharacteristic', () => {
  it('dispatches on the ble-plx UUID and base64 value', () => {
    const parsed = parseCharacteristic('00002a37-0000-1000-8000-00805f9b34fb', 'FkgAEAQ=');
    assert.equal(parsed?.type, 'heartRate');
    assert.equal(parsed?.type === 'heartRate' && parsed.value.bpm, 72);
  });
  it('returns undefined for vendor characteristics', () => {
    assert.equal(parseCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e', 'AA=='), undefined);
  });
});
