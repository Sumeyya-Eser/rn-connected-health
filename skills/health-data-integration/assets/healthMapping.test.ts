// Runs with zero dependencies: node --experimental-strip-types --test healthMapping.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  externalIdFor,
  mapBloodPressure,
  mapGlucose,
  mapHeartRate,
  mapOxygenSaturation,
  mapTemperature,
  resolveTime,
  toHealthConnect,
  toHealthKit,
  type HealthSample,
  type MappingResult,
} from './healthMapping.ts';

const receivedAt = new Date('2026-09-24T12:00:00Z');
const ctx = { device: { manufacturer: 'Acme', model: 'BP-1', serial: 'SN123' }, receivedAt };

function sample(r: MappingResult): HealthSample {
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.sample;
}

describe('resolveTime', () => {
  it('trusts a plausible device time', () => {
    const t = new Date('2026-09-24T11:55:00Z');
    assert.deepEqual(resolveTime(t, receivedAt), { time: t, timeSource: 'device' });
  });
  it('falls back to receive time for future, ancient or missing device time', () => {
    for (const t of [new Date('2026-09-24T13:00:00Z'), new Date('1999-01-01T00:00:00Z'), undefined, new Date(NaN)]) {
      assert.deepEqual(resolveTime(t, receivedAt), { time: receivedAt, timeSource: 'phone' });
    }
  });
});

describe('externalIdFor', () => {
  it('prefers serial, then manufacturer-model', () => {
    assert.equal(externalIdFor('weight', { serial: 'S1', model: 'M' }, 'k'), 'S1:weight:k');
    assert.equal(externalIdFor('weight', { manufacturer: 'A', model: 'M' }, 'k'), 'A-M:weight:k');
    assert.equal(externalIdFor('weight', {}, 'k'), 'unknown:weight:k');
  });
});

describe('validation', () => {
  it('rejects implausible and inconsistent blood pressure', () => {
    assert.equal(mapBloodPressure({ systolicMmHg: 16, diastolicMmHg: 10.7 }, ctx).ok, false); // kPa passed as mmHg
    assert.equal(mapBloodPressure({ systolicMmHg: 80, diastolicMmHg: 120 }, ctx).ok, false);
    assert.equal(mapBloodPressure({ systolicMmHg: NaN, diastolicMmHg: 80 }, ctx).ok, false);
  });
  it('rejects control solution glucose and lost HR contact', () => {
    assert.deepEqual(mapGlucose({ sequenceNumber: 1, mgPerDl: 100, isControlSolution: true }, ctx), {
      ok: false,
      reason: 'control solution test',
    });
    assert.equal(mapHeartRate({ bpm: 70, sensorContact: false }, ctx).ok, false);
  });
  it('rejects Fahrenheit passed as Celsius', () => {
    assert.equal(mapTemperature({ celsius: 98.6 }, ctx).ok, false);
  });
});

describe('HealthKit descriptors', () => {
  it('writes SpO2 as a fraction', () => {
    const hk = toHealthKit(sample(mapOxygenSaturation({ spo2: 98 }, ctx)));
    assert.equal(hk.kind === 'quantity' && hk.value, 0.98);
    assert.equal(hk.kind === 'quantity' && hk.unit, '%');
  });
  it('writes blood pressure as a correlation with sync identifier', () => {
    const ts = new Date('2026-09-24T11:50:00Z');
    const hk = toHealthKit(sample(mapBloodPressure({ systolicMmHg: 120, diastolicMmHg: 80, timestamp: ts }, ctx)));
    assert.equal(hk.kind, 'correlation');
    assert.equal(hk.kind === 'correlation' && hk.samples.length, 2);
    assert.equal(hk.metadata.HKMetadataKeySyncIdentifier, `SN123:bloodPressure:${ts.toISOString()}`);
    assert.equal(hk.metadata.HKMetadataKeyDeviceSerialNumber, 'SN123');
  });
});

describe('Health Connect records', () => {
  it('writes SpO2 as a percent', () => {
    const hc = toHealthConnect(sample(mapOxygenSaturation({ spo2: 98 }, ctx)));
    assert.equal(hc.recordType, 'OxygenSaturation');
    assert.equal(hc.percentage, 98);
  });
  it('writes glucose with specimen source and a stable clientRecordId from the sequence number', () => {
    const hc = toHealthConnect(
      sample(mapGlucose({ sequenceNumber: 42, mgPerDl: 95, sampleType: 'capillaryWholeBlood', isControlSolution: false }, ctx)),
    );
    assert.equal(hc.recordType, 'BloodGlucose');
    assert.deepEqual(hc.level, { value: 95, unit: 'milligramsPerDeciliter' });
    assert.equal(hc.specimenSource, 2);
    assert.equal((hc.metadata as { clientRecordId: string }).clientRecordId, 'SN123:bloodGlucose:seq42');
  });
});
