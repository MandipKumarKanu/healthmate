import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

// Foreground notifications must remain visible and audible. Android 8+ uses the
// channel's sound/vibration settings for delivery behavior.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (error) {
  // Expo Go and web may not expose the native notification module.
}

export const notificationService = {
  async init(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
      await Notifications.setNotificationChannelAsync('medication-reminders', {
        name: 'Medication Reminders',
        description: 'Time-sensitive medication dose alarms',
        importance: AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300, 200, 500],
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        lightColor: '#0788F5',
        bypassDnd: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    } catch (error) {
      console.warn('Unable to configure medication notification channel:', error);
    }
  },

  /**
   * Ask for notification display permission and Android's exact-alarm access.
   * A notification permission grant alone does not guarantee on-time alarms.
   */
  async requestPermissions(): Promise<boolean> {
    try {
      await this.init();

      const current = await Notifications.getPermissionsAsync();
      let notificationGranted = current.granted || current.status === 'granted';
      if (!notificationGranted) {
        const requested = await Notifications.requestPermissionsAsync();
        notificationGranted = requested.granted || requested.status === 'granted';
      }
      if (!notificationGranted) return false;

      if (Platform.OS === 'android') {
        let exactAlarm = await Notifications.getExactAlarmPermissionsAsync();
        if (!exactAlarm.granted) {
          try {
            exactAlarm = await Notifications.requestExactAlarmPermissionsAsync();
          } catch (error) {
            console.warn('Exact-alarm access was not granted:', error);
            return false;
          }
        }
        if (!exactAlarm.granted) return false;
      }

      return true;
    } catch (error) {
      console.warn('Unable to confirm reminder permissions:', error);
      return false;
    }
  },

  async hasReliableAlarmAccess(): Promise<boolean> {
    try {
      const notificationPermission = await Notifications.getPermissionsAsync();
      if (!(notificationPermission.granted || notificationPermission.status === 'granted')) {
        return false;
      }
      if (Platform.OS !== 'android') return true;
      const exactAlarm = await Notifications.getExactAlarmPermissionsAsync();
      return exactAlarm.granted;
    } catch {
      return false;
    }
  },

  async scheduleDoseReminder(
    scheduleId: string,
    medicineName: string,
    amount: string,
    time: string, // 'HH:mm'
    doseLabel?: string
  ): Promise<string | null> {
    try {
      const [hourStr, minStr] = time.split(':');
      const hour = Number(hourStr);
      const minute = Number(minStr);
      if (
        !Number.isInteger(hour) || hour < 0 || hour > 23 ||
        !Number.isInteger(minute) || minute < 0 || minute > 59
      ) {
        throw new Error(`Invalid reminder time: ${time}`);
      }

      // Do not silently fall back to an inexact Android alarm. The caller must
      // first obtain exact-alarm access; otherwise report scheduling failure.
      if (!(await this.hasReliableAlarmAccess())) {
        console.warn('Reminder not scheduled: notification or exact-alarm permission is missing.');
        return null;
      }

      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: `Time to take ${medicineName}`,
          body: `${doseLabel ? `${doseLabel} · ` : ''}Scheduled dose: ${amount}`,
          data: { scheduleId, time, medicineName },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: 'medication-reminders' } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          ...(Platform.OS === 'android' ? { channelId: 'medication-reminders', delivery: 'alarmClock' as const } : {}),
        },
      });

      return identifier;
    } catch (error) {
      console.warn('Failed to schedule medication alarm:', error);
      return null;
    }
  },

  async cancelNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (error) {
      console.warn('Failed to cancel notification:', error);
    }
  },

  async cancelForSchedule(scheduleId: string): Promise<void> {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const matching = scheduled.filter(
        (notification) => notification.content.data?.scheduleId === scheduleId
      );
      await Promise.all(
        matching.map((notification) =>
          Notifications.cancelScheduledNotificationAsync(notification.identifier)
        )
      );
    } catch (error) {
      console.warn('Failed to cancel schedule notifications:', error);
    }
  },

  async cancelAll(): Promise<void> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.warn('Failed to cancel all notifications:', error);
    }
  },
};
