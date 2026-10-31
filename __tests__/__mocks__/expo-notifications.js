const SchedulableTriggerInputTypes = {
  DATE: 'date',
  TIME_INTERVAL: 'timeInterval',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  CALENDAR: 'calendar',
};

const AndroidImportance = {
  UNKNOWN: 0,
  UNSPECIFIED: 1,
  NONE: 2,
  MIN: 3,
  LOW: 4,
  DEFAULT: 5,
  HIGH: 6,
  MAX: 7,
};

const AndroidNotificationVisibility = {
  UNKNOWN: 0,
  PUBLIC: 1,
  PRIVATE: 2,
  SECRET: 3,
};

let scheduledNotifications = [];

module.exports = {
  SchedulableTriggerInputTypes,
  AndroidImportance,
  AndroidNotificationVisibility,

  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  getExactAlarmPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted', granted: true }),
  requestExactAlarmPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: 'granted', granted: true }),

  scheduleNotificationAsync: jest.fn().mockImplementation(async (request) => {
    const identifier = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    scheduledNotifications.push({ identifier, ...request });
    return identifier;
  }),

  cancelScheduledNotificationAsync: jest.fn().mockImplementation(async (identifier) => {
    scheduledNotifications = scheduledNotifications.filter((n) => n.identifier !== identifier);
  }),

  cancelAllScheduledNotificationsAsync: jest.fn().mockImplementation(async () => {
    scheduledNotifications = [];
  }),

  getAllScheduledNotificationsAsync: jest.fn().mockImplementation(async () => {
    return [...scheduledNotifications];
  }),

  __getScheduledNotifications: () => scheduledNotifications,
  __clearScheduledNotifications: () => {
    scheduledNotifications = [];
  },
};
