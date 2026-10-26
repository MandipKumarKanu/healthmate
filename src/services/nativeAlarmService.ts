import { NativeModules, Platform } from "react-native";

interface NativeAlarmModuleInterface {
  stopAlarm(): Promise<boolean>;
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
}

const AlarmModule: NativeAlarmModuleInterface | undefined =
  Platform.OS === "android" ? NativeModules.AlarmModule : undefined;

export const nativeAlarmService = {
  isAvailable(): boolean {
    return Platform.OS === "android" && Boolean(AlarmModule);
  },

  async stopAlarm(): Promise<boolean> {
    if (!AlarmModule) return false;
    try {
      return await AlarmModule.stopAlarm();
    } catch (e) {
      console.warn("nativeAlarmService.stopAlarm failed:", e);
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
      return await AlarmModule.snoozeAlarm(
        params.scheduleId,
        params.medicineName,
        params.amount,
        params.time,
        params.label ?? "",
        params.minutes ?? 10,
      );
    } catch (e) {
      console.warn("nativeAlarmService.snoozeAlarm failed:", e);
      return null;
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
        params.label ?? "",
        params.triggerAtMillis,
      );
    } catch (e) {
      console.warn("nativeAlarmService.scheduleAlarm failed:", e);
      return false;
    }
  },

  async cancelAlarm(scheduleId: string): Promise<boolean> {
    if (!AlarmModule) return false;
    try {
      return await AlarmModule.cancelAlarm(scheduleId);
    } catch (e) {
      console.warn("nativeAlarmService.cancelAlarm failed:", e);
      return false;
    }
  },

  async cancelAllAlarms(): Promise<boolean> {
    if (!AlarmModule) return false;
    try {
      return await AlarmModule.cancelAllAlarms();
    } catch (e) {
      console.warn("nativeAlarmService.cancelAllAlarms failed:", e);
      return false;
    }
  },

  async canScheduleExactAlarms(): Promise<boolean> {
    if (Platform.OS !== "android") return true;
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
      console.warn("nativeAlarmService.dismissKeyguard failed:", e);
      return false;
    }
  },
};
