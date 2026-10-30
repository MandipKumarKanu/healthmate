const Platform = {
  OS: 'android',
  Version: 34,
  select: (obj) => (obj && obj.android !== undefined ? obj.android : obj?.default),
};

const NativeModules = {
  AlarmModule: {
    stopAlarm: jest.fn().mockResolvedValue(true),
    stopDoseAlarm: jest.fn().mockResolvedValue(true),
    getActiveAlarms: jest.fn().mockResolvedValue('[]'),
    syncAlarmChain: jest.fn().mockResolvedValue(true),
    snoozeAlarm: jest.fn().mockResolvedValue(Date.now() + 600000),
    scheduleAlarm: jest.fn().mockResolvedValue(true),
    cancelAlarm: jest.fn().mockResolvedValue(true),
    cancelSnoozesForSchedule: jest.fn().mockResolvedValue(true),
    cancelAllAlarms: jest.fn().mockResolvedValue(true),
    canScheduleExactAlarms: jest.fn().mockResolvedValue(true),
    getLastRecoveryReport: jest.fn().mockResolvedValue(null),
    triggerRecovery: jest.fn().mockResolvedValue(
      JSON.stringify({
        timestamp: Date.now(),
        totalProcessed: 0,
        recoveredCount: 0,
        expiredCount: 0,
        failedCount: 0,
        malformedCount: 0,
        details: [],
      }),
    ),
    dismissKeyguard: jest.fn().mockResolvedValue(true),
    isIgnoringBatteryOptimizations: jest.fn().mockResolvedValue(true),
    requestIgnoreBatteryOptimizations: jest.fn().mockResolvedValue(true),
    openExactAlarmSettings: jest.fn().mockResolvedValue(true),
    openAppBatterySettings: jest.fn().mockResolvedValue(true),
    getDeviceManufacturer: jest.fn().mockResolvedValue('samsung'),
    openOemAutoStartSettings: jest.fn().mockResolvedValue(true),
    canUseFullScreenIntent: jest.fn().mockResolvedValue(true),
    openFullScreenIntentSettings: jest.fn().mockResolvedValue(true),
  },
};

const Keyboard = {
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  removeListener: jest.fn(),
  dismiss: jest.fn(),
};

const Dimensions = {
  get: jest.fn(() => ({ width: 390, height: 844, scale: 3, fontScale: 1 })),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
};

module.exports = {
  Platform,
  NativeModules,
  Keyboard,
  Dimensions,
};
