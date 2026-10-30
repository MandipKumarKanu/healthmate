import { NativeModules, Platform } from 'react-native';
import type { ReminderSchedule } from '../types';
import { profileRepository } from '../database/repositories/profileRepository';

export type NativeAlarmErrorCode =
  | 'module_unavailable'
  | 'exact_alarm_denied'
  | 'permission_denied'
  | 'invalid_trigger'
  | 'registration_failed'
  | 'cancellation_failed'
  | 'unknown';

export interface NativeAlarmDiagnostic {
  code: NativeAlarmErrorCode;
  message: string;
}

export interface NativeAlarmResult<T = boolean> {
  success: boolean;
  data?: T;
  error?: NativeAlarmDiagnostic;
}

export interface NativeRecoveryDetail {
  scheduleId: string;
  time: string;
  status: 'recovered' | 'expired' | 'failed' | 'malformed';
  isExact?: boolean;
  triggerAtMillis?: number;
  error?: string;
}

export interface NativeRecoveryReport {
  timestamp: number;
  totalProcessed: number;
  recoveredCount: number;
  expiredCount: number;
  failedCount: number;
  malformedCount: number;
  details: NativeRecoveryDetail[];
}

export interface ActiveRingingAlarm {
  scheduleId: string;
  medicineName: string;
  amount: string;
  time: string;
  label?: string;
  instanceId?: string;
  sourceScheduleId?: string;
  notificationId?: number;
}

export type AlarmPrecisionMode = 'exact' | 'inexact_fallback';

export class NativeActionResult implements NativeAlarmResult<boolean> {
  constructor(
    public success: boolean,
    public data: boolean = success,
    public error?: NativeAlarmDiagnostic,
    public isExact: boolean = true,
  ) {}

  valueOf(): boolean {
    return this.success;
  }
}

export class SnoozeAlarmResult implements NativeAlarmResult<number> {
  constructor(
    public success: boolean,
    public data?: number,
    public error?: NativeAlarmDiagnostic,
  ) {}

  get scheduledAt(): number | undefined {
    return this.data;
  }

  valueOf(): number {
    return this.data ?? 0;
  }
}

export function mapNativeError(e: unknown): NativeAlarmDiagnostic {
  const codeStr = String((e as any)?.code ?? '').toUpperCase();
  const msg = String((e as any)?.message ?? (e instanceof Error ? e.message : String(e)));

  if (
    codeStr.includes('EXACT_ALARM') ||
    codeStr.includes('SCHEDULE_EXACT') ||
    msg.toLowerCase().includes('exact alarm')
  ) {
    return { code: 'exact_alarm_denied', message: 'Exact alarm permission is denied or revoked' };
  }
  if (
    codeStr.includes('PERMISSION') ||
    msg.toLowerCase().includes('permission') ||
    msg.toLowerCase().includes('security')
  ) {
    return { code: 'permission_denied', message: 'Notification or alarm permission is denied' };
  }
  if (
    codeStr.includes('INVALID_TRIGGER') ||
    msg.toLowerCase().includes('trigger') ||
    msg.toLowerCase().includes('future')
  ) {
    return { code: 'invalid_trigger', message: 'Invalid alarm trigger timestamp or format' };
  }
  if (codeStr.includes('CANCEL') || msg.toLowerCase().includes('cancel')) {
    return { code: 'cancellation_failed', message: 'Failed to cancel alarm with system alarm manager' };
  }
  if (
    codeStr.includes('REGISTRATION') ||
    codeStr.includes('SCHEDULE') ||
    msg.toLowerCase().includes('alarmmanager') ||
    msg.toLowerCase().includes('register')
  ) {
    return { code: 'registration_failed', message: 'Android system failed to register alarm with AlarmManager' };
  }

  return { code: 'unknown', message: msg || 'An unknown native alarm error occurred' };
}

export type NativeAlarmActionResult = NativeActionResult;
export type NativeSnoozeResult = SnoozeAlarmResult;

interface NativeAlarmModuleInterface {
  stopAlarm(): Promise<boolean>;
  stopDoseAlarm?(scheduleId: string, time: string): Promise<boolean>;
  getActiveAlarms?(): Promise<string>;
  syncAlarmChain(
    scheduleId: string,
    medicineName: string,
    amount: string,
    time: string,
    label: string,
    recurrence: string,
    startDate: string,
    endDate: string,
    triggersJson: string,
  ): Promise<boolean>;
  snoozeAlarm(
    sourceScheduleId: string,
    snoozeId: string,
    sourceInstanceId: string,
    medicineName: string,
    amount: string,
    time: string,
    label: string,
    minutes: number,
  ): Promise<number>;
  scheduleAlarm(
    scheduleId: string,
    medicineName: string,
    amount: string,
    time: string,
    label: string,
    triggerAtMillis: number,
  ): Promise<boolean>;
  cancelAlarm(scheduleId: string): Promise<boolean>;
  cancelSnoozesForSchedule?(scheduleId: string): Promise<boolean>;
  cancelAllAlarms(): Promise<boolean>;
  canScheduleExactAlarms(): Promise<boolean>;
  getLastRecoveryReport?(): Promise<string | null>;
  triggerRecovery?(): Promise<string>;
  dismissKeyguard(): Promise<boolean>;
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<boolean>;
  openExactAlarmSettings(): Promise<boolean>;
  openAppBatterySettings(): Promise<boolean>;
  openOemAutoStartSettings(): Promise<boolean>;
  canUseFullScreenIntent(): Promise<boolean>;
  openFullScreenIntentSettings(): Promise<boolean>;
  getDeviceManufacturer(): Promise<string>;
}

function getAlarmModule(): NativeAlarmModuleInterface | undefined {
  return Platform.OS === 'android' ? (NativeModules.AlarmModule as NativeAlarmModuleInterface | undefined) : undefined;
}

export const nativeAlarmService = {
  isAvailable(): boolean {
    return Platform.OS === 'android' && Boolean(getAlarmModule());
  },

  async stopAlarm(scheduleId?: string, time?: string): Promise<NativeAlarmActionResult> {
    const alarmModule = getAlarmModule();
    if (!alarmModule) {
      return new NativeActionResult(false, false, {
        code: 'module_unavailable',
        message: 'Native AlarmModule is unavailable',
      });
    }
    try {
      let res = false;
      if (scheduleId && alarmModule.stopDoseAlarm) {
        res = await alarmModule.stopDoseAlarm(scheduleId, time || '');
      } else {
        res = await alarmModule.stopAlarm();
      }
      return new NativeActionResult(res, res);
    } catch (e) {
      const mapped = mapNativeError(e);
      console.warn('nativeAlarmService.stopAlarm failed:', mapped.code);
      return new NativeActionResult(false, false, mapped);
    }
  },

  async stopDoseAlarm(scheduleId: string, time: string): Promise<NativeAlarmActionResult> {
    return this.stopAlarm(scheduleId, time);
  },

  async getActiveAlarms(): Promise<ActiveRingingAlarm[]> {
    const alarmModule = getAlarmModule();
    if (!alarmModule?.getActiveAlarms) return [];
    try {
      const raw = await alarmModule.getActiveAlarms();
      return raw ? (JSON.parse(raw) as ActiveRingingAlarm[]) : [];
    } catch {
      return [];
    }
  },

  async snoozeAlarm(params: {
    scheduleId: string;
    instanceId: string;
    medicineName: string;
    amount: string;
    time: string;
    label?: string;
    minutes?: number;
  }): Promise<SnoozeAlarmResult> {
    const alarmModule = getAlarmModule();
    if (!alarmModule) {
      return new SnoozeAlarmResult(false, undefined, {
        code: 'module_unavailable',
        message: 'Native AlarmModule is unavailable',
      });
    }
    try {
      let snoozeMinutes = params.minutes;
      if (!snoozeMinutes || ![5, 10, 15, 20].includes(snoozeMinutes)) {
        try {
          const prefs = profileRepository.getPreferences();
          snoozeMinutes = prefs.snoozeIntervalMinutes;
        } catch {
          snoozeMinutes = 10;
        }
      }
      if (!snoozeMinutes || ![5, 10, 15, 20].includes(snoozeMinutes)) {
        snoozeMinutes = 10;
      }

      const snoozeId = `${params.scheduleId}::snooze::${params.instanceId}`;
      const scheduledAt = await alarmModule.snoozeAlarm(
        params.scheduleId,
        snoozeId,
        params.instanceId,
        params.medicineName,
        params.amount,
        params.time,
        params.label ?? '',
        snoozeMinutes,
      );
      if (!scheduledAt || scheduledAt <= Date.now()) {
        return new SnoozeAlarmResult(false, undefined, {
          code: 'registration_failed',
          message: 'Native snooze registration returned invalid trigger timestamp',
        });
      }
      return new SnoozeAlarmResult(true, scheduledAt);
    } catch (e) {
      const mapped = mapNativeError(e);
      console.warn('nativeAlarmService.snoozeAlarm failed for schedule:', params.scheduleId, mapped.code);
      return new SnoozeAlarmResult(false, undefined, mapped);
    }
  },

  /**
   * Pushes the full upcoming trigger window (epoch millis, computed by the JS
   * scheduler) for one dose into native storage and arms the earliest one.
   * The native side re-arms these chains after reboot with no app launch.
   */
  async syncAlarmChain(params: {
    scheduleId: string;
    medicineName: string;
    amount: string;
    time: string;
    label?: string;
    recurrence: ReminderSchedule['recurrence'];
    startDate: string;
    endDate?: string;
    triggerMillis: number[];
  }): Promise<NativeAlarmActionResult> {
    const alarmModule = getAlarmModule();
    if (!alarmModule) {
      return new NativeActionResult(false, false, {
        code: 'module_unavailable',
        message: 'Native AlarmModule is unavailable',
      });
    }
    try {
      const res = await alarmModule.syncAlarmChain(
        params.scheduleId,
        params.medicineName,
        params.amount,
        params.time,
        params.label ?? '',
        params.recurrence,
        params.startDate,
        params.endDate ?? '',
        JSON.stringify(params.triggerMillis),
      );
      if (!res) {
        return new NativeActionResult(false, false, {
          code: 'invalid_trigger',
          message: 'No valid future triggers within schedule bounds',
        });
      }
      const isExact = await this.canScheduleExactAlarms();
      return new NativeActionResult(true, true, undefined, isExact);
    } catch (e) {
      const mapped = mapNativeError(e);
      console.warn('nativeAlarmService.syncAlarmChain failed for schedule:', params.scheduleId, mapped.code);
      return new NativeActionResult(false, false, mapped);
    }
  },

  async scheduleAlarm(params: {
    scheduleId: string;
    medicineName: string;
    amount: string;
    time: string;
    label?: string;
    triggerAtMillis: number;
  }): Promise<NativeAlarmActionResult> {
    const alarmModule = getAlarmModule();
    if (!alarmModule) {
      return new NativeActionResult(false, false, {
        code: 'module_unavailable',
        message: 'Native AlarmModule is unavailable',
      });
    }
    try {
      const res = await alarmModule.scheduleAlarm(
        params.scheduleId,
        params.medicineName,
        params.amount,
        params.time,
        params.label ?? '',
        params.triggerAtMillis,
      );
      return new NativeActionResult(res, res);
    } catch (e) {
      const mapped = mapNativeError(e);
      console.warn('nativeAlarmService.scheduleAlarm failed for schedule:', params.scheduleId, mapped.code);
      return new NativeActionResult(false, false, mapped);
    }
  },

  async cancelAlarm(scheduleId: string): Promise<NativeAlarmActionResult> {
    const alarmModule = getAlarmModule();
    if (!alarmModule) {
      return new NativeActionResult(false, false, {
        code: 'module_unavailable',
        message: 'Native AlarmModule is unavailable',
      });
    }
    try {
      const res = await alarmModule.cancelAlarm(scheduleId);
      return new NativeActionResult(res, res);
    } catch (e) {
      const mapped = mapNativeError(e);
      console.warn('nativeAlarmService.cancelAlarm failed for schedule:', scheduleId, mapped.code);
      return new NativeActionResult(false, false, mapped);
    }
  },

  async cancelSnoozesForSchedule(scheduleId: string): Promise<NativeAlarmActionResult> {
    const alarmModule = getAlarmModule();
    if (!alarmModule) {
      return new NativeActionResult(false, false, {
        code: 'module_unavailable',
        message: 'Native AlarmModule is unavailable',
      });
    }
    try {
      if (alarmModule.cancelSnoozesForSchedule) {
        const res = await alarmModule.cancelSnoozesForSchedule(scheduleId);
        return new NativeActionResult(res, res);
      }
      const isExact = await this.canScheduleExactAlarms();
      return new NativeActionResult(true, true, undefined, isExact);
    } catch (e) {
      const mapped = mapNativeError(e);
      console.warn('nativeAlarmService.cancelSnoozesForSchedule failed for schedule:', scheduleId, mapped.code);
      return new NativeActionResult(false, false, mapped);
    }
  },

  async cancelSnooze(scheduleId: string, instanceId: string): Promise<NativeAlarmActionResult> {
    const snoozeId = `${scheduleId}::snooze::${instanceId}`;
    return await this.cancelAlarm(snoozeId);
  },

  async cancelAllAlarms(): Promise<NativeAlarmActionResult> {
    const alarmModule = getAlarmModule();
    if (!alarmModule) {
      return new NativeActionResult(false, false, {
        code: 'module_unavailable',
        message: 'Native AlarmModule is unavailable',
      });
    }
    try {
      const res = await alarmModule.cancelAllAlarms();
      return new NativeActionResult(res, res);
    } catch (e) {
      const mapped = mapNativeError(e);
      console.warn('nativeAlarmService.cancelAllAlarms failed:', mapped.code);
      return new NativeActionResult(false, false, mapped);
    }
  },

  async canScheduleExactAlarms(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const alarmModule = getAlarmModule();
    if (!alarmModule?.canScheduleExactAlarms) return false;
    try {
      return await alarmModule.canScheduleExactAlarms();
    } catch {
      return false;
    }
  },

  async getAlarmPrecisionMode(): Promise<AlarmPrecisionMode> {
    const isExact = await this.canScheduleExactAlarms();
    return isExact ? 'exact' : 'inexact_fallback';
  },

  async getLastRecoveryReport(): Promise<NativeRecoveryReport | null> {
    const alarmModule = getAlarmModule();
    if (!alarmModule?.getLastRecoveryReport) return null;
    try {
      const raw = await alarmModule.getLastRecoveryReport();
      return raw ? (JSON.parse(raw) as NativeRecoveryReport) : null;
    } catch {
      return null;
    }
  },

  async triggerRecovery(): Promise<NativeRecoveryReport | null> {
    const alarmModule = getAlarmModule();
    if (!alarmModule?.triggerRecovery) return null;
    try {
      const raw = await alarmModule.triggerRecovery();
      return raw ? (JSON.parse(raw) as NativeRecoveryReport) : null;
    } catch {
      return null;
    }
  },

  async dismissKeyguard(): Promise<boolean> {
    const alarmModule = getAlarmModule();
    if (!alarmModule) return false;
    try {
      return await alarmModule.dismissKeyguard();
    } catch (e) {
      console.warn('nativeAlarmService.dismissKeyguard failed:', e);
      return false;
    }
  },

  async isIgnoringBatteryOptimizations(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const alarmModule = getAlarmModule();
    if (!alarmModule?.isIgnoringBatteryOptimizations) return true;
    try {
      return await alarmModule.isIgnoringBatteryOptimizations();
    } catch (e) {
      console.warn('nativeAlarmService.isIgnoringBatteryOptimizations failed:', e);
      return false;
    }
  },

  async requestIgnoreBatteryOptimizations(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const alarmModule = getAlarmModule();
    if (!alarmModule?.requestIgnoreBatteryOptimizations) return false;
    try {
      return await alarmModule.requestIgnoreBatteryOptimizations();
    } catch (e) {
      console.warn('nativeAlarmService.requestIgnoreBatteryOptimizations failed:', e);
      return false;
    }
  },

  async openExactAlarmSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const alarmModule = getAlarmModule();
    if (!alarmModule?.openExactAlarmSettings) return false;
    try {
      return await alarmModule.openExactAlarmSettings();
    } catch (e) {
      console.warn('nativeAlarmService.openExactAlarmSettings failed:', e);
      return false;
    }
  },

  async openAppBatterySettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const alarmModule = getAlarmModule();
    if (!alarmModule?.openAppBatterySettings) return false;
    try {
      return await alarmModule.openAppBatterySettings();
    } catch (e) {
      console.warn('nativeAlarmService.openAppBatterySettings failed:', e);
      return false;
    }
  },

  async openOemAutoStartSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const alarmModule = getAlarmModule();
    if (!alarmModule?.openOemAutoStartSettings) return false;
    try {
      return await alarmModule.openOemAutoStartSettings();
    } catch (e) {
      console.warn('nativeAlarmService.openOemAutoStartSettings failed:', e);
      return false;
    }
  },

  async canUseFullScreenIntent(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const alarmModule = getAlarmModule();
    if (!alarmModule?.canUseFullScreenIntent) return true;
    try {
      return await alarmModule.canUseFullScreenIntent();
    } catch {
      return true;
    }
  },

  async openFullScreenIntentSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const alarmModule = getAlarmModule();
    if (!alarmModule?.openFullScreenIntentSettings) return false;
    try {
      return await alarmModule.openFullScreenIntentSettings();
    } catch (e) {
      console.warn('nativeAlarmService.openFullScreenIntentSettings failed:', e);
      return false;
    }
  },

  async getDeviceManufacturer(): Promise<string> {
    if (Platform.OS !== 'android') return 'generic';
    const alarmModule = getAlarmModule();
    if (!alarmModule?.getDeviceManufacturer) return 'unknown';
    try {
      return await alarmModule.getDeviceManufacturer();
    } catch (e) {
      console.warn('nativeAlarmService.getDeviceManufacturer failed:', e);
      return 'unknown';
    }
  },
};
