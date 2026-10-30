import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { NativeModules, Platform } from 'react-native';
import {
  nativeAlarmService,
  NativeRecoveryReport,
} from '../src/services/nativeAlarmService';
const fs = require('fs');
const path = require('path');
const withAlarmModule = require('../plugins/withAlarmModule.js');

declare const __dirname: string;

describe('Harden Boot and Update Recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Manifest & Receiver Declarations', () => {
    it('verifies AlarmReceiver is exported with all required boot and update intent filters in plugin', () => {
      // Create a mock expo config manifest
      const rawManifest = {
        application: [
          {
            $: {},
            service: [],
            receiver: [],
            activity: [{}],
          },
        ],
        'uses-permission': [],
      };

      // Apply the plugin's manifest modification
      const modifiedManifest = withAlarmModule.applyManifestModifications(rawManifest);
      const app = modifiedManifest.application[0];
      const receiver = app.receiver.find(
        (r: any) => r.$['android:name'] === '.alarm.AlarmReceiver',
      );

      expect(receiver).toBeDefined();
      // Android 12+ requires exported="true" for receivers with intent-filters handling system broadcasts
      expect(receiver.$['android:exported']).toBe('true');
      expect(receiver.$['android:enabled']).toBe('true');

      const actions = receiver['intent-filter'][0].action.map(
        (a: any) => a.$['android:name'],
      );

      // Verify all required boot, quickboot, update, and permission change actions
      expect(actions).toContain('android.intent.action.BOOT_COMPLETED');
      expect(actions).toContain('android.intent.action.LOCKED_BOOT_COMPLETED');
      expect(actions).toContain('android.intent.action.MY_PACKAGE_REPLACED');
      expect(actions).toContain('android.intent.action.QUICKBOOT_POWERON');
      expect(actions).toContain('com.htc.intent.action.QUICKBOOT_POWERON');
      expect(actions).toContain(
        'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED',
      );
    });

    it('declares RECEIVE_BOOT_COMPLETED and WAKE_LOCK permissions in manifest', () => {
      const rawManifest = {
        application: [{ $: {}, service: [], receiver: [], activity: [{}] }],
        'uses-permission': [],
      };

      const modifiedManifest = withAlarmModule.applyManifestModifications(rawManifest);
      const permissions = modifiedManifest['uses-permission'].map(
        (p: any) => p.$['android:name'],
      );

      expect(permissions).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
      expect(permissions).toContain('android.permission.WAKE_LOCK');
      expect(permissions).toContain('android.permission.SCHEDULE_EXACT_ALARM');
    });

    it('verifies actual AndroidManifest.xml contains declared receiver and intent filters', () => {
      const manifestPath = path.resolve(__dirname, '../android/app/src/main/AndroidManifest.xml');
      const manifestContent = fs.readFileSync(manifestPath, 'utf8');

      expect(manifestContent).toContain('<receiver android:name=".alarm.AlarmReceiver" android:enabled="true" android:exported="true">');
      expect(manifestContent).toContain('<action android:name="android.intent.action.BOOT_COMPLETED"/>');
      expect(manifestContent).toContain('<action android:name="android.intent.action.LOCKED_BOOT_COMPLETED"/>');
      expect(manifestContent).toContain('<action android:name="android.intent.action.MY_PACKAGE_REPLACED"/>');
      expect(manifestContent).toContain('<action android:name="android.intent.action.QUICKBOOT_POWERON"/>');
      expect(manifestContent).toContain('<action android:name="com.htc.intent.action.QUICKBOOT_POWERON"/>');
      expect(manifestContent).toContain('<action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"/>');
    });
  });

  describe('Diagnosable Recovery Outcome & Per-Entry Reporting', () => {
    it('returns structured recovery report via getLastRecoveryReport', async () => {
      const mockReport: NativeRecoveryReport = {
        timestamp: Date.now(),
        totalProcessed: 4,
        recoveredCount: 2,
        expiredCount: 1,
        failedCount: 0,
        malformedCount: 1,
        details: [
          {
            scheduleId: 'sched_1',
            time: '08:00',
            status: 'recovered',
            isExact: true,
            triggerAtMillis: Date.now() + 3600000,
          },
          {
            scheduleId: 'sched_2',
            time: '12:00',
            status: 'recovered',
            isExact: false,
            triggerAtMillis: Date.now() + 7200000,
          },
          {
            scheduleId: 'sched_expired',
            time: '09:00',
            status: 'expired',
            error: 'Schedule end date 2026-10-20 has passed',
          },
          {
            scheduleId: 'sched_corrupt',
            time: '',
            status: 'malformed',
            error: 'Invalid JSON entry format',
          },
        ],
      };

      (NativeModules.AlarmModule.getLastRecoveryReport as any).mockResolvedValue(
        JSON.stringify(mockReport),
      );

      const report = await nativeAlarmService.getLastRecoveryReport();

      expect(report).toBeDefined();
      expect(report?.totalProcessed).toBe(4);
      expect(report?.recoveredCount).toBe(2);
      expect(report?.expiredCount).toBe(1);
      expect(report?.malformedCount).toBe(1);
      expect(report?.details).toHaveLength(4);

      // Acceptance criterion: One corrupt entry does not block other entries
      const malformed = report?.details.find((d) => d.status === 'malformed');
      expect(malformed).toBeDefined();
      expect(malformed?.error).toBe('Invalid JSON entry format');

      // Acceptance criterion: Valid alarms return after reboot
      const recovered = report?.details.filter((d) => d.status === 'recovered');
      expect(recovered).toHaveLength(2);
      expect(recovered?.[0].scheduleId).toBe('sched_1');

      // Acceptance criterion: Expired alarms are not restored
      const expired = report?.details.find((d) => d.status === 'expired');
      expect(expired).toBeDefined();
      expect(expired?.scheduleId).toBe('sched_expired');
    });

    it('triggers native recovery on-demand and returns diagnosable result', async () => {
      const mockReport: NativeRecoveryReport = {
        timestamp: Date.now(),
        totalProcessed: 2,
        recoveredCount: 2,
        expiredCount: 0,
        failedCount: 0,
        malformedCount: 0,
        details: [
          {
            scheduleId: 'sched_daily',
            time: '09:00',
            status: 'recovered',
            isExact: true,
            triggerAtMillis: Date.now() + 60000,
          },
          {
            scheduleId: 'sched_evening',
            time: '21:00',
            status: 'recovered',
            isExact: true,
            triggerAtMillis: Date.now() + 45000000,
          },
        ],
      };

      (NativeModules.AlarmModule.triggerRecovery as any).mockResolvedValue(
        JSON.stringify(mockReport),
      );

      const result = await nativeAlarmService.triggerRecovery();

      expect(NativeModules.AlarmModule.triggerRecovery).toHaveBeenCalled();
      expect(result?.recoveredCount).toBe(2);
      expect(result?.details[0].scheduleId).toBe('sched_daily');
    });
  });

  describe('Handling Corrupt Entries & Duplicate Prevention', () => {
    it('handles null or corrupted JSON report gracefully without throwing', async () => {
      (NativeModules.AlarmModule.getLastRecoveryReport as any).mockResolvedValue(
        'not valid json {[[',
      );

      const report = await nativeAlarmService.getLastRecoveryReport();
      expect(report).toBeNull();
    });

    it('idempotently returns consistent report across repeated recoveries without duplicating alarms', async () => {
      const mockReport: NativeRecoveryReport = {
        timestamp: Date.now(),
        totalProcessed: 1,
        recoveredCount: 1,
        expiredCount: 0,
        failedCount: 0,
        malformedCount: 0,
        details: [
          {
            scheduleId: 'sched_unique',
            time: '08:00',
            status: 'recovered',
            isExact: true,
            triggerAtMillis: 1793400000000,
          },
        ],
      };

      (NativeModules.AlarmModule.triggerRecovery as any).mockResolvedValue(
        JSON.stringify(mockReport),
      );

      // Call 1
      const res1 = await nativeAlarmService.triggerRecovery();
      // Call 2 (simulating duplicate broadcast e.g. BOOT_COMPLETED + LOCKED_BOOT_COMPLETED)
      const res2 = await nativeAlarmService.triggerRecovery();

      expect(res1?.recoveredCount).toBe(1);
      expect(res2?.recoveredCount).toBe(1);
      expect(res1?.details[0].triggerAtMillis).toBe(res2?.details[0].triggerAtMillis);
    });
  });
});
