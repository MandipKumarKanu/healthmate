const Platform = {
  OS: "android",
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
  },
};

module.exports = {
  Platform,
  NativeModules,
};
