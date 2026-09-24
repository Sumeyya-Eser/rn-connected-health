---
name: ble-firmware-update
description: Use when implementing or debugging over-the-air (OTA) firmware updates for BLE devices from a React Native app — Nordic DFU (Secure/Buttonless DFU), MCUmgr/SMP (Zephyr, MCUboot), vendor OTA protocols, update UX, recovery from failed updates, and the change-control implications of updating firmware on medical devices.
---

# BLE firmware updates (OTA / DFU) from React Native

A failed firmware update can **brick a device the user depends on for health measurements**. Correctness and recovery matter more than speed.

## 1. Identify the bootloader / protocol

Check before choosing a library:

| Signal on the device | Protocol | Typical RN library |
|---|---|---|
| Service `0xFE59` (Nordic Secure DFU / Buttonless DFU) | Nordic DFU (nRF5 SDK / nRF Connect SDK legacy) | a maintained `react-native-nordic-dfu` fork |
| Service `8d53dc1d-1db7-4cd3-868b-8a527460aa84` (SMP) | MCUmgr / SMP (Zephyr, MCUboot, nRF Connect SDK) | `@playerdata/react-native-mcu-manager` |
| Proprietary service or characteristic | vendor OTA | custom, built on ble-plx + `gattQueue` |

Check the library's last release, new-architecture support and Expo compatibility (all need native code, so use a dev client). Firmware images come from the device team: a `.zip` for Nordic DFU, an MCUboot image (`.bin`) for SMP.

## 2. Hand over the connection

DFU libraries use **their own native BLE stack**, separate from `react-native-ble-plx`.

1. Stop all monitors, clear the GATT queue, and call `manager.cancelDeviceConnection(id)`.
2. Pause your auto-reconnect logic. Otherwise it fights the DFU library for the device.
3. Start the DFU with the device address (Android) or the peripheral UUID (iOS).
4. After completion, wait for the device to reboot (a few seconds), **then** rescan and reconnect with ble-plx.

Address changes:
- Nordic **Buttonless DFU** reboots into a bootloader that often advertises with **address + 1** on Android and under a different name ("DfuTarg"). Most DFU libraries handle this, so don't filter the post-DFU scan by the old address.
- On iOS, the peripheral UUID of the bootloader can differ from the app firmware's. Match by the serial number (Device Information) after the update, never by `device.id`.

## 3. Pre-flight checks (block the update if any fail)

- [ ] Device battery ≥ 30–50 % (read Battery Level 0x2A19) **and** phone battery OK or charging.
- [ ] The image matches the hardware revision / model (check the manifest or metadata against the Device Information Service). Flashing the wrong board image is the classic brick.
- [ ] The image is signed and the device verifies the signature (Nordic Secure DFU, MCUboot signing). Never ship unsigned OTA for medical devices.
- [ ] Image integrity checked in the app (a SHA-256 in your release manifest, downloaded over HTTPS).
- [ ] No measurement is in progress and no unsynced records are left on the device. **Sync stored records (for example glucose RACP) first.** Some bootloaders erase the data area.
- [ ] The user explicitly confirmed. Never auto-update in the background for health devices.

## 4. During the update: UX and platform rules

- Keep the screen awake (`expo-keep-awake` / `react-native-keep-awake`) and tell the user to keep the phone near the device and the app open.
- iOS: the update stops if the app is backgrounded for long. Warn the user. Android: run inside a foreground service if the transfer takes more than about 30 s (see `ble-background-sync`).
- Show real progress (percentage and bytes) plus distinct states: *preparing → starting bootloader → uploading → validating → rebooting → verifying*.
- Android: a higher MTU and packet receipt notifications (PRN) speed things up. If you see errors on some phones, lower PRN or disable parallel upload. Samsung devices are often the slowest to cooperate.
- Don't let the user leave the screen without a confirmation dialog.

## 5. After the update

- Reconnect and read Firmware Revision (0x2A26). **Only report success when the new version is confirmed.**
- MCUboot: the image is *test*-swapped first. The app must **confirm** it after verifying the device works (`confirm` command), or it reverts on the next reboot. Decide deliberately what "works" means.
- Re-sync the device clock (Current Time Service) if the update reset it.
- Log the old version, new version, duration, phone model and error codes to analytics, with no health data in the log.

## 6. Recovery

- Nordic Secure DFU with a dual bank / MCUboot swap keeps the old image when the transfer fails. Retrying is safe.
- Single-bank devices stay in bootloader mode after a failed transfer. The app must be able to **find a device in DFU mode** (scan for the DFU service or name) and resume, even after an app restart. Persist "update in progress for serial X, image Y".
- Provide a "Retry update" path and a support contact. Never tell the user the device is fine when you don't know.

## 7. Medical devices: regulatory note

For a regulated medical device, a firmware release is a **design change** under the manufacturer's quality system (ISO 13485 / IEC 62304, EU MDR, FDA). The app delivering it is part of that system:
- Only deliver images released through that process. The app must not be able to flash arbitrary files in production builds.
- Keep traceability of which device received which version (serial ↔ version ↔ date).
- Staged rollout and the ability to halt it are expected.

This is software guidance, not regulatory advice. Involve the manufacturer's regulatory/QA team.
