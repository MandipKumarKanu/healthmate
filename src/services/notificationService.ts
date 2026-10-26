import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

// Configure notification behavior
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
} catch (e) {
  // Silent fallback when notifications native module is absent
}

export const notificationService = {
  async init(): Promise<void> {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('medication-reminders', {
          name: 'Medication Reminders',
          importance: AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#0788F5',
        });
      }
    } catch (e) {
      console.warn('Notifications channel init bypassed:', e);
    }
  },

  async requestPermissions(): Promise<boolean> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      return finalStatus === 'granted';
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
      const hour = parseInt(hourStr, 10);
      const minute = parseInt(minStr, 10);

      const identifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: `Time to take ${medicineName}`,
          body: `${doseLabel ? `${doseLabel} · ` : ''}Scheduled dose: ${amount}`,
          data: { scheduleId, time, medicineName },
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
        },
      });

      return identifier;
    } catch (error) {
      console.warn('Failed to schedule notification:', error);
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
