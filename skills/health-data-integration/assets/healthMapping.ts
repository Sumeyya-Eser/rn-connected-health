/**
 * BLE reading → validated HealthSample → HealthKit / Health Connect write descriptors.
 *
 * Library-agnostic on purpose: this file produces plain data. A thin platform adapter
 * (see references/platform-adapters.md) passes it to @kingstinct/react-native-healthkit or
 * react-native-health-connect. That keeps the unit conversions, plausibility checks and
 * dedupe IDs testable without a phone.
 */

export interface DeviceInfo {
  manufacturer?: string;
  model?: string;
  /** From Device Information 0x2A25. Never the iOS peripheral id, which differs per phone. */
  serial?: string;
  firmware?: string;
}

export type SampleKind = 'heartRate' | 'bloodPressure' | 'bodyTemperature' | 'bloodGlucose' | 'weight' | 'oxygenSaturation';

interface SampleBase {
  kind: SampleKind;
  time: Date;
  /** 'device' when the payload carried a trustworthy timestamp, else 'phone' (receive time). */
  timeSource: 'device' | 'phone';
  /** Deterministic: the same reading synced twice gets the same id → no duplicates. */
  externalId: string;
  device: DeviceInfo;
}

export type HealthSample =
  | (SampleBase & { kind: 'heartRate'; bpm: number })
  | (SampleBase & { kind: 'bloodPressure'; systolicMmHg: number; diastolicMmHg: number; pulseBpm?: number })
  | (SampleBase & { kind: 'bodyTemperature'; celsius: number })
  | (SampleBase & { kind: 'bloodGlucose'; mgPerDl: number; specimen?: 'capillaryBlood' | 'interstitialFluid' | 'plasma' | 'wholeBlood' })
  | (SampleBase & { kind: 'weight'; kilograms: number })
  | (SampleBase & { kind: 'oxygenSaturation'; percent: number });

export type MappingResult = { ok: true; sample: HealthSample } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Wide physiological bounds. They catch parser bugs, unit mix-ups and sensor garbage, and are
 * NOT clinical thresholds. Apple 5.1.3 forbids writing inaccurate data to HealthKit.
 */
export const PLAUSIBLE = {
  heartRateBpm: [20, 300],
  systolicMmHg: [40, 300],
  diastolicMmHg: [20, 200],
  celsius: [25, 45],
  glucoseMgPerDl: [10, 1000],
  kilograms: [0.5, 500],
  spo2Percent: [50, 100],
} as const;

function inRange(v: number | undefined, [lo, hi]: readonly [number, number]): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

/** Device clocks drift or were never set. Anything more than 5 min in the future, or before 2000, is not trusted. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const EARLIEST_PLAUSIBLE = Date.UTC(2000, 0, 1);

export function resolveTime(deviceTime: Date | undefined, receivedAt: Date): { time: Date; timeSource: 'device' | 'phone' } {
  if (deviceTime && !Number.isNaN(deviceTime.getTime())) {
    const t = deviceTime.getTime();
    if (t >= EARLIEST_PLAUSIBLE && t <= receivedAt.getTime() + MAX_FUTURE_SKEW_MS) {
      return { time: deviceTime, timeSource: 'device' };
    }
  }
  return { time: receivedAt, timeSource: 'phone' };
}

/**
 * `${deviceKey}:${kind}:${recordKey}`. Use the device's own record key when it has one (glucose
 * sequence number). Otherwise use the device timestamp. With only phone time, the reading can't be
 * recognised on re-sync, so we fall back to the receive time (dedupe works only within one delivery).
 */
export function externalIdFor(kind: SampleKind, device: DeviceInfo, recordKey: string): string {
  const deviceKey = device.serial || [device.manufacturer, device.model].filter(Boolean).join('-') || 'unknown';
  return `${deviceKey}:${kind}:${recordKey}`;
}

// ---------------------------------------------------------------------------
// From parsed BLE measurements (shapes match assets/healthParsers.ts in ble-react-native,
// declared structurally so this file has no import dependency on it)
// ---------------------------------------------------------------------------

export interface MapContext {
  device: DeviceInfo;
  receivedAt: Date;
}

function base(kind: SampleKind, deviceTime: Date | undefined, ctx: MapContext, recordKey?: string) {
  const { time, timeSource } = resolveTime(deviceTime, ctx.receivedAt);
  return {
    time,
    timeSource,
    device: ctx.device,
    externalId: externalIdFor(kind, ctx.device, recordKey ?? time.toISOString()),
  };
}

export function mapHeartRate(m: { bpm: number; sensorContact?: boolean }, ctx: MapContext): MappingResult {
  if (m.sensorContact === false) return { ok: false, reason: 'no sensor contact' };
  if (!inRange(m.bpm, PLAUSIBLE.heartRateBpm)) return { ok: false, reason: `implausible heart rate ${m.bpm}` };
  return { ok: true, sample: { kind: 'heartRate', bpm: m.bpm, ...base('heartRate', undefined, ctx) } };
}

export function mapBloodPressure(
  m: { systolicMmHg: number; diastolicMmHg: number; pulseRate?: number; timestamp?: Date },
  ctx: MapContext,
): MappingResult {
  if (!inRange(m.systolicMmHg, PLAUSIBLE.systolicMmHg) || !inRange(m.diastolicMmHg, PLAUSIBLE.diastolicMmHg)) {
    return { ok: false, reason: `implausible blood pressure ${m.systolicMmHg}/${m.diastolicMmHg}` };
  }
  if (m.diastolicMmHg >= m.systolicMmHg) return { ok: false, reason: 'diastolic ≥ systolic' };
  return {
    ok: true,
    sample: {
      kind: 'bloodPressure',
      systolicMmHg: m.systolicMmHg,
      diastolicMmHg: m.diastolicMmHg,
      pulseBpm: inRange(m.pulseRate, PLAUSIBLE.heartRateBpm) ? m.pulseRate : undefined,
      ...base('bloodPressure', m.timestamp, ctx),
    },
  };
}

export function mapTemperature(m: { celsius: number; timestamp?: Date }, ctx: MapContext): MappingResult {
  if (!inRange(m.celsius, PLAUSIBLE.celsius)) return { ok: false, reason: `implausible body temperature ${m.celsius} °C` };
  return { ok: true, sample: { kind: 'bodyTemperature', celsius: m.celsius, ...base('bodyTemperature', m.timestamp, ctx) } };
}

export function mapWeight(m: { kilograms: number; timestamp?: Date }, ctx: MapContext): MappingResult {
  if (!inRange(m.kilograms, PLAUSIBLE.kilograms)) return { ok: false, reason: `implausible weight ${m.kilograms} kg` };
  return { ok: true, sample: { kind: 'weight', kilograms: m.kilograms, ...base('weight', m.timestamp, ctx) } };
}

export function mapOxygenSaturation(m: { spo2: number; timestamp?: Date }, ctx: MapContext): MappingResult {
  if (!inRange(m.spo2, PLAUSIBLE.spo2Percent)) return { ok: false, reason: `implausible SpO2 ${m.spo2}` };
  return { ok: true, sample: { kind: 'oxygenSaturation', percent: m.spo2, ...base('oxygenSaturation', m.timestamp, ctx) } };
}

const SPECIMEN_BY_SAMPLE_TYPE: Record<string, 'capillaryBlood' | 'interstitialFluid' | 'plasma' | 'wholeBlood'> = {
  capillaryWholeBlood: 'capillaryBlood',
  capillaryPlasma: 'capillaryBlood',
  venousWholeBlood: 'wholeBlood',
  arterialWholeBlood: 'wholeBlood',
  undeterminedWholeBlood: 'wholeBlood',
  venousPlasma: 'plasma',
  arterialPlasma: 'plasma',
  undeterminedPlasma: 'plasma',
  interstitialFluid: 'interstitialFluid',
};

export function mapGlucose(
  m: { sequenceNumber: number; mgPerDl?: number; timestamp?: Date; sampleType?: string; isControlSolution: boolean },
  ctx: MapContext,
): MappingResult {
  if (m.isControlSolution) return { ok: false, reason: 'control solution test' };
  if (!inRange(m.mgPerDl, PLAUSIBLE.glucoseMgPerDl)) return { ok: false, reason: `implausible glucose ${m.mgPerDl} mg/dL` };
  return {
    ok: true,
    sample: {
      kind: 'bloodGlucose',
      mgPerDl: m.mgPerDl,
      specimen: m.sampleType ? SPECIMEN_BY_SAMPLE_TYPE[m.sampleType] : undefined,
      ...base('bloodGlucose', m.timestamp, ctx, `seq${m.sequenceNumber}`),
    },
  };
}

// ---------------------------------------------------------------------------
// HealthKit descriptors
// ---------------------------------------------------------------------------

export interface HKQuantityWrite {
  kind: 'quantity';
  identifier: string;
  unit: string;
  value: number;
  start: Date;
  end: Date;
  metadata: Record<string, string | number | boolean>;
}

export interface HKCorrelationWrite {
  kind: 'correlation';
  identifier: string;
  samples: { identifier: string; unit: string; value: number }[];
  start: Date;
  end: Date;
  metadata: Record<string, string | number | boolean>;
}

/**
 * HKMetadataKeySyncIdentifier + SyncVersion make HealthKit replace, not duplicate, a sample
 * written again with the same id. HKMetadataKeyExternalUUID is informational only.
 */
function hkMetadata(s: HealthSample): Record<string, string | number | boolean> {
  const md: Record<string, string | number | boolean> = {
    HKMetadataKeySyncIdentifier: s.externalId,
    HKMetadataKeySyncVersion: 1,
    HKMetadataKeyExternalUUID: s.externalId,
  };
  if (s.device.serial) md.HKMetadataKeyDeviceSerialNumber = s.device.serial;
  if (s.device.manufacturer) md.HKMetadataKeyDeviceManufacturerName = s.device.manufacturer;
  if (s.device.firmware) md.HKMetadataKeyFirmwareVersion = s.device.firmware;
  return md;
}

export function toHealthKit(s: HealthSample): HKQuantityWrite | HKCorrelationWrite {
  const q = (identifier: string, unit: string, value: number): HKQuantityWrite => ({
    kind: 'quantity',
    identifier,
    unit,
    value,
    start: s.time,
    end: s.time,
    metadata: hkMetadata(s),
  });
  switch (s.kind) {
    case 'heartRate':
      return q('HKQuantityTypeIdentifierHeartRate', 'count/min', s.bpm);
    case 'bodyTemperature':
      return q('HKQuantityTypeIdentifierBodyTemperature', 'degC', s.celsius);
    case 'bloodGlucose':
      return q('HKQuantityTypeIdentifierBloodGlucose', 'mg/dL', s.mgPerDl);
    case 'weight':
      return q('HKQuantityTypeIdentifierBodyMass', 'kg', s.kilograms);
    case 'oxygenSaturation':
      // HealthKit's '%' unit takes a FRACTION: 98 % is written as 0.98.
      return q('HKQuantityTypeIdentifierOxygenSaturation', '%', Math.round(s.percent * 10) / 1000);
    case 'bloodPressure':
      return {
        kind: 'correlation',
        identifier: 'HKCorrelationTypeIdentifierBloodPressure',
        samples: [
          { identifier: 'HKQuantityTypeIdentifierBloodPressureSystolic', unit: 'mmHg', value: s.systolicMmHg },
          { identifier: 'HKQuantityTypeIdentifierBloodPressureDiastolic', unit: 'mmHg', value: s.diastolicMmHg },
        ],
        start: s.time,
        end: s.time,
        metadata: hkMetadata(s),
      };
  }
}

// ---------------------------------------------------------------------------
// Health Connect records (react-native-health-connect `insertRecords` shape)
// ---------------------------------------------------------------------------

/** androidx.health.connect.client.records.metadata.Metadata.RECORDING_METHOD_ACTIVELY_RECORDED */
const RECORDING_METHOD_ACTIVELY_RECORDED = 1;

/** BloodGlucoseRecord.SPECIMEN_SOURCE_* */
const HC_SPECIMEN_SOURCE = { unknown: 0, interstitialFluid: 1, capillaryBlood: 2, plasma: 3, serum: 4, tears: 5, wholeBlood: 6 } as const;

export type HealthConnectRecord = Record<string, unknown> & { recordType: string };

export function toHealthConnect(s: HealthSample): HealthConnectRecord {
  const time = s.time.toISOString();
  const metadata = {
    clientRecordId: s.externalId,
    clientRecordVersion: 1,
    recordingMethod: RECORDING_METHOD_ACTIVELY_RECORDED,
    device: { manufacturer: s.device.manufacturer, model: s.device.model },
  };
  switch (s.kind) {
    case 'heartRate':
      return { recordType: 'HeartRate', startTime: time, endTime: time, samples: [{ time, beatsPerMinute: s.bpm }], metadata };
    case 'bloodPressure':
      return {
        recordType: 'BloodPressure',
        time,
        systolic: { value: s.systolicMmHg, unit: 'millimetersOfMercury' },
        diastolic: { value: s.diastolicMmHg, unit: 'millimetersOfMercury' },
        bodyPosition: 0,
        measurementLocation: 0,
        metadata,
      };
    case 'bodyTemperature':
      return { recordType: 'BodyTemperature', time, temperature: { value: s.celsius, unit: 'celsius' }, measurementLocation: 0, metadata };
    case 'bloodGlucose':
      return {
        recordType: 'BloodGlucose',
        time,
        level: { value: s.mgPerDl, unit: 'milligramsPerDeciliter' },
        specimenSource: s.specimen ? HC_SPECIMEN_SOURCE[s.specimen] : HC_SPECIMEN_SOURCE.unknown,
        mealType: 0,
        relationToMeal: 0,
        metadata,
      };
    case 'weight':
      return { recordType: 'Weight', time, weight: { value: s.kilograms, unit: 'kilograms' }, metadata };
    case 'oxygenSaturation':
      // Health Connect takes a PERCENT: 98 % is 98.
      return { recordType: 'OxygenSaturation', time, percentage: s.percent, metadata };
  }
}
