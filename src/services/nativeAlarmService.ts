import { NativeModules, Platform } from 'react-native';
import type { ReminderSchedule } from '../types';
import { profileRepository } from '../database/repositories/profileRepository';

interface NativeAlarmModuleInterface {
  stopAlarm(): Promise<boolean>;
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
    scheduleId: string,
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
  cancelAllAlarms(): Promise<boolean>;
  canScheduleExactAlarms(): Promise<boolean>;
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

const AlarmModule: NativeAlarmModuleInterface | undefined =
  Platform.OS === 'android' ? NativeModules.AlarmModule : undefined;

export const nativeAlarmService = {
  isAvailable(): boolean {
    return Platform.OS === 'android' && Boolean(AlarmModule);
  },

  async stopAlarm(): Promise<boolean> {
    if (!AlarmModule) return false;
    try {
      return await AlarmModule.stopAlarm();
    } catch (e) {
      console.warn('nativeAlarmService.stopAlarm failed:', e);
      return false;
    }
  },

  async snoozeAlarm(params: {
    scheduleId: string;
    medicineName: string;
    amount: string;
    time: string;
    label?: string;
    minutes?: number;
  }): Promise<number | null> {
    if (!AlarmModule) return null;
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

      return await AlarmModule.snoozeAlarm(
        params.scheduleId,
        params.medicineName,
        params.amount,
        params.time,
        params.label ?? '',
        snoozeMinutes,
      );
    } catch (e) {
      console.warn('nativeAlarmService.snoozeAlarm failed:', e);
      return null;
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
  }): Promise<boolean> {
    if (!AlarmModule) return false;
    try {
      return await AlarmModule.syncAlarmChain(
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
    } catch (e) {
      console.warn('nativeAlarmService.syncAlarmChain failed:', e);
      return false;
    }
  },

  async scheduleAlarm(params: {
    scheduleId: string;
    medicineName: string;
    amount: string;
    time: string;
    label?: string;
    triggerAtMillis: number;
  }): Promise<boolean> {
    if (!AlarmModule) return false;
    try {
      return await AlarmModule.scheduleAlarm(
        params.scheduleId,
        params.medicineName,
        params.amount,
        params.time,
        params.label ?? '',
        params.triggerAtMillis,
      );
    } catch (e) {
      console.warn('nativeAlarmService.scheduleAlarm failed:', e);
      return false;
    }
  },

  async cancelAlarm(scheduleId: string): Promise<boolean> {
    if (!AlarmModule) return false;
    try {
      return await AlarmModule.cancelAlarm(scheduleId);
    } catch (e) {
      console.warn('nativeAlarmService.cancelAlarm failed:', e);
      return false;
    }
  },

  async cancelAllAlarms(): Promise<boolean> {
    if (!AlarmModule) return false;
    try {
      return await AlarmModule.cancelAllAlarms();
    } catch (e) {
      console.warn('nativeAlarmService.cancelAllAlarms failed:', e);
      return false;
    }
  },

  async canScheduleExactAlarms(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (!AlarmModule?.canScheduleExactAlarms) return true;
    try {
      return await AlarmModule.canScheduleExactAlarms();
    } catch {
      return false;
    }
  },

  async dismissKeyguard(): Promise<boolean> {
    if (!AlarmModule) return false;
    try {
      return await AlarmModule.dismissKeyguard();
    } catch (e) {
      console.warn('nativeAlarmService.dismissKeyguard failed:', e);
      return false;
    }
  },

  async isIgnoringBatteryOptimizations(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (!AlarmModule?.isIgnoringBatteryOptimizations) return true;
    try {
      return await AlarmModule.isIgnoringBatteryOptimizations();
    } catch (e) {
      console.warn('nativeAlarmService.isIgnoringBatteryOptimizations failed:', e);
      return false;
    }
  },

  async requestIgnoreBatteryOptimizations(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (!AlarmModule?.requestIgnoreBatteryOptimizations) return false;
    try {
      return await AlarmModule.requestIgnoreBatteryOptimizations();
    } catch (e) {
      console.warn('nativeAlarmService.requestIgnoreBatteryOptimizations failed:', e);
      return false;
    }
  },

  async openExactAlarmSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (!AlarmModule?.openExactAlarmSettings) return false;
    try {
      return await AlarmModule.openExactAlarmSettings();
    } catch (e) {
      console.warn('nativeAlarmService.openExactAlarmSettings failed:', e);
      return false;
    }
  },

  async openAppBatterySettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (!AlarmModule?.openAppBatterySettings) return false;
    try {
      return await AlarmModule.openAppBatterySettings();
    } catch (e) {
      console.warn('nativeAlarmService.openAppBatterySettings failed:', e);
      return false;
    }
  },

  async openOemAutoStartSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (!AlarmModule?.openOemAutoStartSettings) return false;
    try {
      return await AlarmModule.openOemAutoStartSettings();
    } catch (e) {
      console.warn('nativeAlarmService.openOemAutoStartSettings failed:', e);
      return false;
    }
  },

  async canUseFullScreenIntent(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (!AlarmModule?.canUseFullScreenIntent) return true;
    try {
      return await AlarmModule.canUseFullScreenIntent();
    } catch {
      return true;
    }
  },

  async openFullScreenIntentSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    if (!AlarmModule?.openFullScreenIntentSettings) return false;
    try {
      return await AlarmModule.openFullScreenIntentSettings();
    } catch (e) {
      console.warn('nativeAlarmService.openFullScreenIntentSettings failed:', e);
      return false;
    }
  },

  async getDeviceManufacturer(): Promise<string> {
    if (Platform.OS !== 'android') return 'generic';
    if (!AlarmModule?.getDeviceManufacturer) return 'unknown';
    try {
      return await AlarmModule.getDeviceManufacturer();
    } catch (e) {
      console.warn('nativeAlarmService.getDeviceManufacturer failed:', e);
      return 'unknown';
    }
  },
};
