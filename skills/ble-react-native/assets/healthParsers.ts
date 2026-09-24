/**
 * Parsers for Bluetooth SIG health profiles (GATT characteristics).
 *
 * Self-contained on purpose: no dependencies, no Node `Buffer`, one file you can
 * copy into a React Native project. Every parser takes the raw bytes of one
 * notification/indication/read and returns a typed object.
 *
 * Source: Bluetooth SIG "GATT Specification Supplement". Manufacturers sometimes
 * deviate from it — verify with real captures (nRF Connect) for each device.
 */

// ---------------------------------------------------------------------------
// Bytes, base64, hex
// ---------------------------------------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode the base64 `value` that react-native-ble-plx returns. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const ch of clean) {
    acc = ((acc << 6) | B64_ALPHABET.indexOf(ch)) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

/** Encode bytes to base64, e.g. for `writeCharacteristicWithResponseForDevice`. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += B64_ALPHABET[(triple >> 18) & 0x3f] + B64_ALPHABET[(triple >> 12) & 0x3f];
    out += i + 1 < bytes.length ? B64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[triple & 0x3f] : '=';
  }
  return out;
}

/** "16 48 00", "16-48-00", "0x16 0x48" or "164800" → bytes. Handy for fixtures from nRF Connect logs. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2 !== 0) throw new Error(`hexToBytes: odd number of hex digits in "${hex}"`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** UTF-8 decode for Device Information strings (serial, model, manufacturer). Strips trailing NULs. */
export function decodeUtf8(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += '%' + b.toString(16).padStart(2, '0');
  try {
    return decodeURIComponent(s).replace(/\0+$/, '');
  } catch {
    return String.fromCharCode(...bytes).replace(/\0+$/, '');
  }
}

// ---------------------------------------------------------------------------
// UUIDs
// ---------------------------------------------------------------------------

const BASE_UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/** 0x2a37 → "00002a37-0000-1000-8000-00805f9b34fb" (lowercase, as react-native-ble-plx reports). */
export function toFullUuid(short: number): string {
  return short.toString(16).padStart(8, '0') + BASE_UUID_SUFFIX;
}

/** Returns the 16-bit SIG number for a SIG-base UUID, or undefined for vendor UUIDs. */
export function shortUuid(uuid: string): number | undefined {
  const u = uuid.toLowerCase();
  if (/^[0-9a-f]{4}$/.test(u)) return parseInt(u, 16);
  if (u.length === 36 && u.endsWith(BASE_UUID_SUFFIX) && u.startsWith('0000')) return parseInt(u.slice(4, 8), 16);
  return undefined;
}

export const SigService = {
  deviceInformation: 0x180a,
  healthThermometer: 0x1809,
  heartRate: 0x180d,
  battery: 0x180f,
  glucose: 0x1808,
  bloodPressure: 0x1810,
  weightScale: 0x181d,
  pulseOximeter: 0x1822,
} as const;

export const SigCharacteristic = {
  temperatureMeasurement: 0x2a1c,
  intermediateTemperature: 0x2a1e,
  glucoseMeasurement: 0x2a18,
  glucoseMeasurementContext: 0x2a34,
  batteryLevel: 0x2a19,
  modelNumber: 0x2a24,
  serialNumber: 0x2a25,
  firmwareRevision: 0x2a26,
  manufacturerName: 0x2a29,
  bloodPressureMeasurement: 0x2a35,
  intermediateCuffPressure: 0x2a36,
  heartRateMeasurement: 0x2a37,
  recordAccessControlPoint: 0x2a52,
  plxSpotCheckMeasurement: 0x2a5e,
  plxContinuousMeasurement: 0x2a5f,
  weightMeasurement: 0x2a9d,
} as const;

// ---------------------------------------------------------------------------
// IEEE-11073 SFLOAT / FLOAT
// ---------------------------------------------------------------------------

/** m × 10^e without the binary rounding noise of `m * 10 ** -n` (e.g. 366 × 10^-1 → 36.6, not 36.60000000000001). */
function scale(mantissa: number, exponent: number): number {
  return exponent < 0 ? mantissa / 10 ** -exponent : mantissa * 10 ** exponent;
}

/** 16-bit SFLOAT: 4-bit signed exponent, 12-bit signed mantissa. Special values → NaN / ±Infinity. */
export function sfloatFromRaw(raw: number): number {
  if (raw === 0x07ff || raw === 0x0800 || raw === 0x0801) return NaN; // NaN, NRes, reserved
  if (raw === 0x07fe) return Infinity;
  if (raw === 0x0802) return -Infinity;
  let mantissa = raw & 0x0fff;
  let exponent = (raw >> 12) & 0x0f;
  if (mantissa >= 0x0800) mantissa -= 0x1000;
  if (exponent >= 0x08) exponent -= 0x10;
  return scale(mantissa, exponent);
}

/** 32-bit FLOAT: 8-bit signed exponent, 24-bit signed mantissa. Special values → NaN / ±Infinity. */
export function floatFromRaw(raw: number): number {
  let mantissa = raw & 0xffffff;
  let exponent = (raw >>> 24) & 0xff;
  if (mantissa === 0x7fffff || mantissa === 0x800000 || mantissa === 0x800001) return NaN;
  if (mantissa === 0x7ffffe) return Infinity;
  if (mantissa === 0x800002) return -Infinity;
  if (mantissa >= 0x800000) mantissa -= 0x1000000;
  if (exponent >= 0x80) exponent -= 0x100;
  return scale(mantissa, exponent);
}

/** Encode a value as SFLOAT bytes with a fixed number of decimals. For fake devices and tests. */
export function sfloatBytes(value: number, decimals = 0): [number, number] {
  const mantissa = Math.round(value * 10 ** decimals);
  if (mantissa < -2045 || mantissa > 2045 || decimals < -7 || decimals > 8) {
    throw new RangeError(`sfloatBytes: ${value} with ${decimals} decimals does not fit in SFLOAT`);
  }
  const raw = ((-decimals & 0x0f) << 12) | (mantissa & 0x0fff);
  return [raw & 0xff, raw >> 8];
}

/** Encode a value as FLOAT bytes with a fixed number of decimals. For fake devices and tests. */
export function floatBytes(value: number, decimals = 0): [number, number, number, number] {
  const mantissa = Math.round(value * 10 ** decimals);
  if (mantissa < -8388605 || mantissa > 8388605 || decimals < -127 || decimals > 128) {
    throw new RangeError(`floatBytes: ${value} with ${decimals} decimals does not fit in FLOAT`);
  }
  const m = mantissa & 0xffffff;
  return [m & 0xff, (m >> 8) & 0xff, (m >> 16) & 0xff, -decimals & 0xff];
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

export class TruncatedPayloadError extends Error {
  constructor(what: string, needed: number, available: number) {
    super(`${what}: needs ${needed} byte(s), only ${available} left`);
    this.name = 'TruncatedPayloadError';
  }
}

/** Little-endian cursor over a payload. Throws TruncatedPayloadError instead of reading `undefined`. */
export class ByteReader {
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private take(n: number, what: string): number {
    if (this.remaining < n) throw new TruncatedPayloadError(what, n, this.remaining);
    const at = this.offset;
    this.offset += n;
    return at;
  }

  u8(what = 'uint8'): number {
    return this.bytes[this.take(1, what)];
  }

  u16(what = 'uint16'): number {
    const i = this.take(2, what);
    return this.bytes[i] | (this.bytes[i + 1] << 8);
  }

  s16(what = 'sint16'): number {
    const v = this.u16(what);
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  u24(what = 'uint24'): number {
    const i = this.take(3, what);
    return this.bytes[i] | (this.bytes[i + 1] << 8) | (this.bytes[i + 2] << 16);
  }

  u32(what = 'uint32'): number {
    const i = this.take(4, what);
    return (this.bytes[i] | (this.bytes[i + 1] << 8) | (this.bytes[i + 2] << 16) | (this.bytes[i + 3] << 24)) >>> 0;
  }

  sfloat(what = 'SFLOAT'): number {
    return sfloatFromRaw(this.u16(what));
  }

  float(what = 'FLOAT'): number {
    return floatFromRaw(this.u32(what));
  }

  /** Date Time (0x2A08): year u16, month, day, hours, minutes, seconds. */
  dateTime(what = 'Date Time'): BleDateTime {
    const year = this.u16(what);
    const i = this.take(5, what);
    const b = this.bytes;
    return { year, month: b[i], day: b[i + 1], hours: b[i + 2], minutes: b[i + 3], seconds: b[i + 4] };
  }
}

// ---------------------------------------------------------------------------
// Date Time
// ---------------------------------------------------------------------------

export interface BleDateTime {
  /** 0 = unknown */
  year: number;
  /** 1–12, 0 = unknown */
  month: number;
  /** 1–31, 0 = unknown */
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * BLE Date Time has no time zone: it is the device clock's wall time. We interpret it in the
 * phone's local zone, which is right only if the device clock was set from this phone.
 * Returns undefined when the device reports an unknown date.
 */
export function bleDateTimeToDate(dt: BleDateTime, offsetMinutes = 0): Date | undefined {
  if (dt.year === 0 || dt.month === 0 || dt.day === 0) return undefined;
  return new Date(dt.year, dt.month - 1, dt.day, dt.hours, dt.minutes + offsetMinutes, dt.seconds);
}

/** Encode a Date as BLE Date Time bytes (e.g. to write Current Time or build test fixtures). */
export function dateTimeBytes(d: Date): number[] {
  const y = d.getFullYear();
  return [y & 0xff, y >> 8, d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()];
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------
// Heart Rate Measurement (0x2A37)
// ---------------------------------------------------------------------------

export interface HeartRateMeasurement {
  bpm: number;
  /** undefined when the sensor does not support contact detection */
  sensorContact?: boolean;
  energyExpendedKJ?: number;
  /** RR intervals in milliseconds (wire resolution is 1/1024 s) */
  rrIntervalsMs: number[];
}

export function parseHeartRateMeasurement(bytes: Uint8Array): HeartRateMeasurement {
  const r = new ByteReader(bytes);
  const flags = r.u8('HR flags');
  const bpm = flags & 0x01 ? r.u16('HR value (uint16)') : r.u8('HR value (uint8)');
  const contactSupported = (flags & 0x04) !== 0;
  const energyExpendedKJ = flags & 0x08 ? r.u16('energy expended') : undefined;
  const rrIntervalsMs: number[] = [];
  if (flags & 0x10) {
    while (r.remaining >= 2) rrIntervalsMs.push(round((r.u16('RR interval') / 1024) * 1000, 1));
  }
  return {
    bpm,
    sensorContact: contactSupported ? (flags & 0x02) !== 0 : undefined,
    energyExpendedKJ,
    rrIntervalsMs,
  };
}

// ---------------------------------------------------------------------------
// Blood Pressure Measurement (0x2A35) / Intermediate Cuff Pressure (0x2A36)
// ---------------------------------------------------------------------------

export const KPA_TO_MMHG = 7.50062;

export interface BloodPressureStatus {
  bodyMovement: boolean;
  cuffTooLoose: boolean;
  irregularPulse: boolean;
  pulseRateRange: 'within' | 'exceedsUpper' | 'belowLower' | 'reserved';
  improperPosition: boolean;
}

export interface BloodPressureMeasurement {
  unit: 'mmHg' | 'kPa';
  /** in `unit`. For Intermediate Cuff Pressure this is the current cuff pressure. */
  systolic: number;
  /** in `unit`. NaN for Intermediate Cuff Pressure. */
  diastolic: number;
  /** in `unit`. NaN for Intermediate Cuff Pressure. */
  meanArterialPressure: number;
  systolicMmHg: number;
  diastolicMmHg: number;
  meanArterialPressureMmHg: number;
  timestamp?: Date;
  /** beats per minute */
  pulseRate?: number;
  /** 0xFF = unknown user */
  userId?: number;
  status?: BloodPressureStatus;
}

export function parseBloodPressureMeasurement(bytes: Uint8Array): BloodPressureMeasurement {
  const r = new ByteReader(bytes);
  const flags = r.u8('BP flags');
  const unit = flags & 0x01 ? 'kPa' : 'mmHg';
  const systolic = r.sfloat('systolic');
  const diastolic = r.sfloat('diastolic');
  const meanArterialPressure = r.sfloat('mean arterial pressure');
  const timestamp = flags & 0x02 ? bleDateTimeToDate(r.dateTime('BP timestamp')) : undefined;
  const pulseRate = flags & 0x04 ? r.sfloat('pulse rate') : undefined;
  const userId = flags & 0x08 ? r.u8('user id') : undefined;
  let status: BloodPressureStatus | undefined;
  if (flags & 0x10) {
    const s = r.u16('measurement status');
    const range = (s >> 3) & 0x03;
    status = {
      bodyMovement: (s & 0x01) !== 0,
      cuffTooLoose: (s & 0x02) !== 0,
      irregularPulse: (s & 0x04) !== 0,
      pulseRateRange: (['within', 'exceedsUpper', 'belowLower', 'reserved'] as const)[range],
      improperPosition: (s & 0x20) !== 0,
    };
  }
  const toMmHg = (v: number) => (unit === 'kPa' ? round(v * KPA_TO_MMHG, 1) : v);
  return {
    unit,
    systolic,
    diastolic,
    meanArterialPressure,
    systolicMmHg: toMmHg(systolic),
    diastolicMmHg: toMmHg(diastolic),
    meanArterialPressureMmHg: toMmHg(meanArterialPressure),
    timestamp,
    pulseRate,
    userId,
    status,
  };
}

// ---------------------------------------------------------------------------
// Temperature Measurement (0x2A1C) / Intermediate Temperature (0x2A1E)
// ---------------------------------------------------------------------------

export const TEMPERATURE_TYPES: Record<number, string> = {
  1: 'armpit',
  2: 'body',
  3: 'ear',
  4: 'finger',
  5: 'gastrointestinal',
  6: 'mouth',
  7: 'rectum',
  8: 'toe',
  9: 'tympanum',
};

export interface TemperatureMeasurement {
  unit: 'C' | 'F';
  value: number;
  celsius: number;
  timestamp?: Date;
  /** measurement site, see TEMPERATURE_TYPES */
  type?: string;
}

export function parseTemperatureMeasurement(bytes: Uint8Array): TemperatureMeasurement {
  const r = new ByteReader(bytes);
  const flags = r.u8('temperature flags');
  const unit = flags & 0x01 ? 'F' : 'C';
  const value = r.float('temperature');
  const timestamp = flags & 0x02 ? bleDateTimeToDate(r.dateTime('temperature timestamp')) : undefined;
  let type: string | undefined;
  if (flags & 0x04) {
    const t = r.u8('temperature type');
    type = TEMPERATURE_TYPES[t] ?? `unknown(${t})`;
  }
  const celsius = unit === 'F' ? round(((value - 32) * 5) / 9, 2) : value;
  return { unit, value, celsius, timestamp, type };
}

// ---------------------------------------------------------------------------
// Weight Measurement (0x2A9D)
// ---------------------------------------------------------------------------

export const LB_TO_KG = 0.45359237;

export interface WeightMeasurement {
  unit: 'kg' | 'lb';
  /** in `unit`; NaN when the scale reports "measurement unsuccessful" (0xFFFF) */
  weight: number;
  kilograms: number;
  timestamp?: Date;
  /** 0xFF = unknown user */
  userId?: number;
  bmi?: number;
  /** metres (SI) or inches (imperial) */
  height?: number;
}

export function parseWeightMeasurement(bytes: Uint8Array): WeightMeasurement {
  const r = new ByteReader(bytes);
  const flags = r.u8('weight flags');
  const imperial = (flags & 0x01) !== 0;
  const raw = r.u16('weight');
  // Resolution: SI 0.005 kg, imperial 0.01 lb. Divide instead of multiply to avoid rounding noise.
  const weight = raw === 0xffff ? NaN : imperial ? raw / 100 : raw / 200;
  const timestamp = flags & 0x02 ? bleDateTimeToDate(r.dateTime('weight timestamp')) : undefined;
  const userId = flags & 0x04 ? r.u8('user id') : undefined;
  let bmi: number | undefined;
  let height: number | undefined;
  if (flags & 0x08) {
    bmi = r.u16('BMI') / 10;
    height = imperial ? r.u16('height') / 10 : r.u16('height') / 1000;
  }
  return {
    unit: imperial ? 'lb' : 'kg',
    weight,
    kilograms: imperial ? round(weight * LB_TO_KG, 3) : weight,
    timestamp,
    userId,
    bmi,
    height,
  };
}

// ---------------------------------------------------------------------------
// Glucose Measurement (0x2A18) + Record Access Control Point (0x2A52)
// ---------------------------------------------------------------------------

/** 1 mmol/L of glucose = 18.016 mg/dL (molar mass 180.16 g/mol). */
export const GLUCOSE_MGDL_PER_MMOLL = 18.016;

export const GLUCOSE_SAMPLE_TYPES: Record<number, string> = {
  1: 'capillaryWholeBlood',
  2: 'capillaryPlasma',
  3: 'venousWholeBlood',
  4: 'venousPlasma',
  5: 'arterialWholeBlood',
  6: 'arterialPlasma',
  7: 'undeterminedWholeBlood',
  8: 'undeterminedPlasma',
  9: 'interstitialFluid',
  10: 'controlSolution',
};

export const GLUCOSE_SAMPLE_LOCATIONS: Record<number, string> = {
  1: 'finger',
  2: 'alternateSiteTest',
  3: 'earlobe',
  4: 'controlSolution',
  15: 'notAvailable',
};

export interface GlucoseMeasurement {
  /** Links a measurement to its Glucose Measurement Context and is the natural dedupe key per device. */
  sequenceNumber: number;
  /** base time + time offset */
  timestamp?: Date;
  timeOffsetMinutes?: number;
  /** undefined when the record carries no concentration */
  mgPerDl?: number;
  mmolPerL?: number;
  sampleType?: string;
  sampleLocation?: string;
  /**
   * True for control-solution tests. Never write these to HealthKit / Health Connect
   * or show them as the user's glucose.
   */
  isControlSolution: boolean;
  sensorStatus?: number;
  contextFollows: boolean;
}

export function parseGlucoseMeasurement(bytes: Uint8Array): GlucoseMeasurement {
  const r = new ByteReader(bytes);
  const flags = r.u8('glucose flags');
  const sequenceNumber = r.u16('sequence number');
  const baseTime = r.dateTime('base time');
  const timeOffsetMinutes = flags & 0x01 ? r.s16('time offset') : undefined;
  let mgPerDl: number | undefined;
  let mmolPerL: number | undefined;
  let sampleType: string | undefined;
  let sampleLocation: string | undefined;
  let isControlSolution = false;
  if (flags & 0x02) {
    const concentration = r.sfloat('glucose concentration');
    if (flags & 0x04) {
      mmolPerL = round(concentration * 1000, 2); // mol/L → mmol/L
      mgPerDl = round(mmolPerL * GLUCOSE_MGDL_PER_MMOLL, 1);
    } else {
      mgPerDl = round(concentration * 100000, 1); // kg/L → mg/dL
      mmolPerL = round(mgPerDl / GLUCOSE_MGDL_PER_MMOLL, 2);
    }
    const typeLocation = r.u8('type-sample location');
    const type = typeLocation & 0x0f;
    const location = typeLocation >> 4;
    sampleType = GLUCOSE_SAMPLE_TYPES[type] ?? `unknown(${type})`;
    sampleLocation = GLUCOSE_SAMPLE_LOCATIONS[location] ?? `unknown(${location})`;
    isControlSolution = type === 10 || location === 4;
  }
  const sensorStatus = flags & 0x08 ? r.u16('sensor status annunciation') : undefined;
  return {
    sequenceNumber,
    timestamp: bleDateTimeToDate(baseTime, timeOffsetMinutes ?? 0),
    timeOffsetMinutes,
    mgPerDl,
    mmolPerL,
    sampleType,
    sampleLocation,
    isControlSolution,
    sensorStatus,
    contextFollows: (flags & 0x10) !== 0,
  };
}

export const RacpOpCode = {
  reportStoredRecords: 0x01,
  deleteStoredRecords: 0x02,
  abortOperation: 0x03,
  reportNumberOfStoredRecords: 0x04,
  numberOfStoredRecordsResponse: 0x05,
  responseCode: 0x06,
} as const;

export const RacpOperator = {
  null: 0x00,
  allRecords: 0x01,
  lessThanOrEqual: 0x02,
  greaterThanOrEqual: 0x03,
  withinRange: 0x04,
  firstRecord: 0x05,
  lastRecord: 0x06,
} as const;

/** Operand filter type for glucose: 0x01 = sequence number, 0x02 = user facing time. */
const RACP_FILTER_SEQUENCE_NUMBER = 0x01;

export const RACP_RESPONSE_MESSAGES: Record<number, string> = {
  0x01: 'success',
  0x02: 'op code not supported',
  0x03: 'invalid operator',
  0x04: 'operator not supported',
  0x05: 'invalid operand',
  0x06: 'no records found',
  0x07: 'abort unsuccessful',
  0x08: 'procedure not completed',
  0x09: 'operand not supported',
};

export const racp = {
  reportAllRecords: (): Uint8Array => Uint8Array.of(RacpOpCode.reportStoredRecords, RacpOperator.allRecords),
  /** Incremental sync: only records with sequence number ≥ `sequenceNumber`. */
  reportRecordsFrom: (sequenceNumber: number): Uint8Array =>
    Uint8Array.of(
      RacpOpCode.reportStoredRecords,
      RacpOperator.greaterThanOrEqual,
      RACP_FILTER_SEQUENCE_NUMBER,
      sequenceNumber & 0xff,
      (sequenceNumber >> 8) & 0xff,
    ),
  reportLastRecord: (): Uint8Array => Uint8Array.of(RacpOpCode.reportStoredRecords, RacpOperator.lastRecord),
  reportNumberOfRecords: (): Uint8Array =>
    Uint8Array.of(RacpOpCode.reportNumberOfStoredRecords, RacpOperator.allRecords),
  abort: (): Uint8Array => Uint8Array.of(RacpOpCode.abortOperation, RacpOperator.null),
};

export type RacpResponse =
  | { kind: 'numberOfRecords'; count: number }
  | { kind: 'responseCode'; requestOpCode: number; code: number; success: boolean; message: string };

export function parseRacpResponse(bytes: Uint8Array): RacpResponse {
  const r = new ByteReader(bytes);
  const opCode = r.u8('RACP op code');
  r.u8('RACP operator');
  if (opCode === RacpOpCode.numberOfStoredRecordsResponse) {
    return { kind: 'numberOfRecords', count: r.u16('number of records') };
  }
  if (opCode === RacpOpCode.responseCode) {
    const requestOpCode = r.u8('request op code');
    const code = r.u8('response code');
    return {
      kind: 'responseCode',
      requestOpCode,
      code,
      success: code === 0x01,
      message: RACP_RESPONSE_MESSAGES[code] ?? `unknown(${code})`,
    };
  }
  throw new Error(`parseRacpResponse: unexpected op code 0x${opCode.toString(16)}`);
}

// ---------------------------------------------------------------------------
// Pulse Oximeter: PLX Spot-Check (0x2A5E) and Continuous (0x2A5F)
// ---------------------------------------------------------------------------

export interface PlxSpotCheckMeasurement {
  /** percent, 0–100 */
  spo2: number;
  /** beats per minute */
  pulseRate: number;
  /** undefined also when the device says its clock is not set */
  timestamp?: Date;
  measurementStatus?: number;
  deviceAndSensorStatus?: number;
  pulseAmplitudeIndex?: number;
  deviceClockNotSet: boolean;
}

export function parsePlxSpotCheck(bytes: Uint8Array): PlxSpotCheckMeasurement {
  const r = new ByteReader(bytes);
  const flags = r.u8('PLX spot-check flags');
  const spo2 = r.sfloat('SpO2');
  const pulseRate = r.sfloat('pulse rate');
  const deviceClockNotSet = (flags & 0x10) !== 0;
  const dt = flags & 0x01 ? r.dateTime('PLX timestamp') : undefined;
  const measurementStatus = flags & 0x02 ? r.u16('measurement status') : undefined;
  const deviceAndSensorStatus = flags & 0x04 ? r.u24('device and sensor status') : undefined;
  const pulseAmplitudeIndex = flags & 0x08 ? r.sfloat('pulse amplitude index') : undefined;
  return {
    spo2,
    pulseRate,
    timestamp: dt && !deviceClockNotSet ? bleDateTimeToDate(dt) : undefined,
    measurementStatus,
    deviceAndSensorStatus,
    pulseAmplitudeIndex,
    deviceClockNotSet,
  };
}

export interface PlxContinuousMeasurement {
  spo2: number;
  pulseRate: number;
  fast?: { spo2: number; pulseRate: number };
  slow?: { spo2: number; pulseRate: number };
  measurementStatus?: number;
  deviceAndSensorStatus?: number;
  pulseAmplitudeIndex?: number;
}

export function parsePlxContinuous(bytes: Uint8Array): PlxContinuousMeasurement {
  const r = new ByteReader(bytes);
  const flags = r.u8('PLX continuous flags');
  const spo2 = r.sfloat('SpO2 normal');
  const pulseRate = r.sfloat('PR normal');
  const fast = flags & 0x01 ? { spo2: r.sfloat('SpO2 fast'), pulseRate: r.sfloat('PR fast') } : undefined;
  const slow = flags & 0x02 ? { spo2: r.sfloat('SpO2 slow'), pulseRate: r.sfloat('PR slow') } : undefined;
  const measurementStatus = flags & 0x04 ? r.u16('measurement status') : undefined;
  const deviceAndSensorStatus = flags & 0x08 ? r.u24('device and sensor status') : undefined;
  const pulseAmplitudeIndex = flags & 0x10 ? r.sfloat('pulse amplitude index') : undefined;
  return { spo2, pulseRate, fast, slow, measurementStatus, deviceAndSensorStatus, pulseAmplitudeIndex };
}

// ---------------------------------------------------------------------------
// Battery Level (0x2A19)
// ---------------------------------------------------------------------------

export function parseBatteryLevel(bytes: Uint8Array): number {
  return new ByteReader(bytes).u8('battery level');
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export type ParsedCharacteristic =
  | { type: 'heartRate'; value: HeartRateMeasurement }
  | { type: 'bloodPressure'; value: BloodPressureMeasurement }
  | { type: 'intermediateCuffPressure'; value: BloodPressureMeasurement }
  | { type: 'temperature'; value: TemperatureMeasurement }
  | { type: 'intermediateTemperature'; value: TemperatureMeasurement }
  | { type: 'weight'; value: WeightMeasurement }
  | { type: 'glucose'; value: GlucoseMeasurement }
  | { type: 'racp'; value: RacpResponse }
  | { type: 'plxSpotCheck'; value: PlxSpotCheckMeasurement }
  | { type: 'plxContinuous'; value: PlxContinuousMeasurement }
  | { type: 'batteryLevel'; value: number }
  | { type: 'deviceInfo'; field: 'model' | 'serial' | 'firmware' | 'manufacturer'; value: string };

/**
 * Parse by characteristic UUID (short number or ble-plx UUID string). Accepts bytes or the
 * base64 string ble-plx gives you. Returns undefined for characteristics it does not know.
 */
export function parseCharacteristic(uuid: string | number, value: Uint8Array | string): ParsedCharacteristic | undefined {
  const bytes = typeof value === 'string' ? base64ToBytes(value) : value;
  const c = SigCharacteristic;
  switch (typeof uuid === 'number' ? uuid : shortUuid(uuid)) {
    case c.heartRateMeasurement:
      return { type: 'heartRate', value: parseHeartRateMeasurement(bytes) };
    case c.bloodPressureMeasurement:
      return { type: 'bloodPressure', value: parseBloodPressureMeasurement(bytes) };
    case c.intermediateCuffPressure:
      return { type: 'intermediateCuffPressure', value: parseBloodPressureMeasurement(bytes) };
    case c.temperatureMeasurement:
      return { type: 'temperature', value: parseTemperatureMeasurement(bytes) };
    case c.intermediateTemperature:
      return { type: 'intermediateTemperature', value: parseTemperatureMeasurement(bytes) };
    case c.weightMeasurement:
      return { type: 'weight', value: parseWeightMeasurement(bytes) };
    case c.glucoseMeasurement:
      return { type: 'glucose', value: parseGlucoseMeasurement(bytes) };
    case c.recordAccessControlPoint:
      return { type: 'racp', value: parseRacpResponse(bytes) };
    case c.plxSpotCheckMeasurement:
      return { type: 'plxSpotCheck', value: parsePlxSpotCheck(bytes) };
    case c.plxContinuousMeasurement:
      return { type: 'plxContinuous', value: parsePlxContinuous(bytes) };
    case c.batteryLevel:
      return { type: 'batteryLevel', value: parseBatteryLevel(bytes) };
    case c.modelNumber:
      return { type: 'deviceInfo', field: 'model', value: decodeUtf8(bytes) };
    case c.serialNumber:
      return { type: 'deviceInfo', field: 'serial', value: decodeUtf8(bytes) };
    case c.firmwareRevision:
      return { type: 'deviceInfo', field: 'firmware', value: decodeUtf8(bytes) };
    case c.manufacturerName:
      return { type: 'deviceInfo', field: 'manufacturer', value: decodeUtf8(bytes) };
    default:
      return undefined;
  }
}
