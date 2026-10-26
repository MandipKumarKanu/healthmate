const Platform = {
  OS: "android",
  Version: 34,
  select: (obj) =>
    obj && obj.android !== undefined ? obj.android : obj?.default,
};

const NativeModules = {
  AlarmModule: {
    stopAlarm: jest.fn().mockResolvedValue(true),
    snoozeAlarm: jest.fn().mockResolvedValue(Date.now() + 600000),
    scheduleAlarm: jest.fn().mockResolvedValue(true),
    cancelAlarm: jest.fn().mockResolvedValue(true),
    cancelAllAlarms: jest.fn().mockResolvedValue(true),
    canScheduleExactAlarms: jest.fn().mockResolvedValue(true),
    dismissKeyguard: jest.fn().mockResolvedValue(true),
    isIgnoringBatteryOptimizations: jest.fn().mockResolvedValue(true),
    requestIgnoreBatteryOptimizations: jest.fn().mockResolvedValue(true),
    openExactAlarmSettings: jest.fn().mockResolvedValue(true),
    openAppBatterySettings: jest.fn().mockResolvedValue(true),
    getDeviceManufacturer: jest.fn().mockResolvedValue("samsung"),
    openOemAutoStartSettings: jest.fn().mockResolvedValue(true),
  },
};

module.exports = {
  Platform,
  NativeModules,
};
