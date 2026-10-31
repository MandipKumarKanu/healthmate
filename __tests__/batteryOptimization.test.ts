import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import {
  batteryOptimizationService,
  mapManufacturerToOemId,
  OEM_GUIDES,
} from '../src/services/batteryOptimizationService';
import { nativeAlarmService } from '../src/services/nativeAlarmService';
import { NativeModules, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

describe('Battery Optimization & Alarm Reliability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('mapManufacturerToOemId', () => {
    it('correctly maps Samsung devices', () => {
      expect(mapManufacturerToOemId('samsung')).toBe('samsung');
      expect(mapManufacturerToOemId('SAMSUNG')).toBe('samsung');
    });

    it('correctly maps Xiaomi / Redmi / Poco devices', () => {
      expect(mapManufacturerToOemId('Xiaomi')).toBe('xiaomi');
      expect(mapManufacturerToOemId('Redmi')).toBe('xiaomi');
      expect(mapManufacturerToOemId('POCO')).toBe('xiaomi');
    });

    it('correctly maps Huawei / Honor devices', () => {
      expect(mapManufacturerToOemId('HUAWEI')).toBe('huawei');
      expect(mapManufacturerToOemId('honor')).toBe('huawei');
    });

    it('correctly maps Oppo / OnePlus / Realme devices', () => {
      expect(mapManufacturerToOemId('OPPO')).toBe('oppo_oneplus');
      expect(mapManufacturerToOemId('OnePlus')).toBe('oppo_oneplus');
      expect(mapManufacturerToOemId('realme')).toBe('oppo_oneplus');
    });

    it('correctly maps Vivo / iQOO devices', () => {
      expect(mapManufacturerToOemId('vivo')).toBe('vivo');
      expect(mapManufacturerToOemId('iQOO')).toBe('vivo');
    });

    it('falls back to stock for Google, Motorola, or generic devices', () => {
      expect(mapManufacturerToOemId('google')).toBe('stock');
      expect(mapManufacturerToOemId('motorola')).toBe('stock');
      expect(mapManufacturerToOemId('unknown')).toBe('stock');
    });
  });

  describe('OEM Guides Database', () => {
    it('provides guides for all primary OEM ecosystems', () => {
      const guides = batteryOptimizationService.getGuides();
      expect(guides.length).toBeGreaterThanOrEqual(6);

      const guideIds = guides.map((g) => g.id);
      expect(guideIds).toContain('samsung');
      expect(guideIds).toContain('xiaomi');
      expect(guideIds).toContain('huawei');
      expect(guideIds).toContain('oppo_oneplus');
      expect(guideIds).toContain('vivo');
      expect(guideIds).toContain('stock');
    });

    it('each guide contains title, description, and steps', () => {
      for (const guide of OEM_GUIDES) {
        expect(guide.name.length).toBeGreaterThan(0);
        expect(guide.subname.length).toBeGreaterThan(0);
        expect(guide.description.length).toBeGreaterThan(0);
        expect(guide.steps.length).toBeGreaterThan(0);
        for (const step of guide.steps) {
          expect(step.title.length).toBeGreaterThan(0);
          expect(step.description.length).toBeGreaterThan(0);
        }
      }
    });

    it('retrieves specific guide by ID with fallback', () => {
      const samsungGuide = batteryOptimizationService.getGuideById('samsung');
      expect(samsungGuide.name).toBe('Samsung');

      const fallbackGuide = batteryOptimizationService.getGuideById('nonexistent_brand');
      expect(fallbackGuide).toBeDefined();
    });
  });

  describe('batteryOptimizationService getReliabilityStatus', () => {
    it('returns optimal when battery optimization is ignored and exact alarm is allowed', async () => {
      (NativeModules.AlarmModule.isIgnoringBatteryOptimizations as any).mockResolvedValue(true);
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(true);
      (NativeModules.AlarmModule.getDeviceManufacturer as any).mockResolvedValue('samsung');

      const status = await batteryOptimizationService.getReliabilityStatus();

      expect(status.isIgnoringBatteryOptimizations).toBe(true);
      expect(status.canScheduleExactAlarms).toBe(true);
      expect(status.notificationPermission).toBe(true);
      expect(status.isOptimal).toBe(true);
      expect(status.manufacturer).toBe('samsung');
      expect(status.detectedOemId).toBe('samsung');
      expect(status.lastRecoveryReport).toBeNull();
    });

    it('returns non-optimal when battery optimization is NOT ignored', async () => {
      (NativeModules.AlarmModule.isIgnoringBatteryOptimizations as any).mockResolvedValue(false);
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(true);
      (NativeModules.AlarmModule.getDeviceManufacturer as any).mockResolvedValue('xiaomi');

      const status = await batteryOptimizationService.getReliabilityStatus();

      expect(status.isIgnoringBatteryOptimizations).toBe(false);
      expect(status.canScheduleExactAlarms).toBe(true);
      expect(status.isOptimal).toBe(false);
      expect(status.detectedOemId).toBe('xiaomi');
    });

    it('returns non-optimal when exact alarms are NOT permitted', async () => {
      (NativeModules.AlarmModule.isIgnoringBatteryOptimizations as any).mockResolvedValue(true);
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(false);
      (NativeModules.AlarmModule.getDeviceManufacturer as any).mockResolvedValue('google');

      const status = await batteryOptimizationService.getReliabilityStatus();

      expect(status.isIgnoringBatteryOptimizations).toBe(true);
      expect(status.canScheduleExactAlarms).toBe(false);
      expect(status.isOptimal).toBe(false);
      expect(status.detectedOemId).toBe('stock');
    });

    it('returns non-optimal when notification permission is revoked', async () => {
      (Notifications.getPermissionsAsync as any).mockResolvedValueOnce({
        status: 'denied',
        granted: false,
      });
      (NativeModules.AlarmModule.isIgnoringBatteryOptimizations as any).mockResolvedValue(true);
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(true);
      (NativeModules.AlarmModule.getDeviceManufacturer as any).mockResolvedValue('google');

      const status = await batteryOptimizationService.getReliabilityStatus();

      expect(status.notificationPermission).toBe(false);
      expect(status.isOptimal).toBe(false);
    });
  });

  describe('nativeAlarmService & battery settings actions', () => {
    it('calls requestIgnoreBatteryOptimizations on native module', async () => {
      const res = await batteryOptimizationService.requestIgnoreBatteryOptimizations();
      expect(NativeModules.AlarmModule.requestIgnoreBatteryOptimizations).toHaveBeenCalled();
      expect(res).toBe(true);
    });

    it('calls openExactAlarmSettings on native module', async () => {
      const res = await batteryOptimizationService.openExactAlarmSettings();
      expect(NativeModules.AlarmModule.openExactAlarmSettings).toHaveBeenCalled();
      expect(res).toBe(true);
    });

    it('calls openOemAutoStartSettings on native module', async () => {
      const res = await batteryOptimizationService.openOemAutoStartSettings();
      expect(NativeModules.AlarmModule.openOemAutoStartSettings).toHaveBeenCalled();
      expect(res).toBe(true);
    });

    it('calls openAppBatterySettings on native module', async () => {
      const res = await batteryOptimizationService.openAppBatterySettings();
      expect(NativeModules.AlarmModule.openAppBatterySettings).toHaveBeenCalled();
      expect(res).toBe(true);
    });

    it('handles nativeAlarmService getDeviceManufacturer gracefully', async () => {
      (NativeModules.AlarmModule.getDeviceManufacturer as any).mockResolvedValue('oneplus');
      const mfr = await nativeAlarmService.getDeviceManufacturer();
      expect(mfr).toBe('oneplus');
    });

    it('catches intent failures and falls back gracefully without throwing unhandled exceptions', async () => {
      (NativeModules.AlarmModule.requestIgnoreBatteryOptimizations as any).mockRejectedValueOnce(
        new Error('Activity not found'),
      );

      const res = await batteryOptimizationService.requestIgnoreBatteryOptimizations();
      expect(res).toBe(false);
    });

    it('detects androidVersion from Platform.Version in reliability status', async () => {
      const status = await batteryOptimizationService.getReliabilityStatus();
      expect(status.androidVersion).toBe(34);
    });

    it('OEM guide and disclaimer emphasize best-effort and do not guarantee delivery', () => {
      for (const guide of OEM_GUIDES) {
        expect(guide.description.toLowerCase()).not.toContain('guaranteed');
        // Each guide contains helpful actionable instructions
        expect(guide.steps.length).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
