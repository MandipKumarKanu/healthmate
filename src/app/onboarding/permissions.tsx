import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Linking,
  AppState,
  AppStateStatus,
} from 'react-native';
import { AppAlert as Alert } from '../../services/appAlert';
import { useRouter, useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useAppStore } from '../../store/appStore';
import { AppScreen } from '../../components/ui/AppScreen';
import { Colors } from '../../theme/colors';
import { Radius, Spacing } from '../../theme/tokens';
import { nativeAlarmService } from '../../services/nativeAlarmService';
import { batteryOptimizationService } from '../../services/batteryOptimizationService';

type PermissionStatus = 'granted' | 'denied' | 'needs_settings' | 'not_determined' | 'unavailable';

export default function OnboardingPermissionsScreen() {
  const router = useRouter();
  const navigation = useNavigation<any>();
  const { completeOnboarding, profile } = useAppStore();

  useEffect(() => {
    if (profile?.onboardingCompleted) {
      try {
        navigation.reset({
          index: 0,
          routes: [{ name: '(tabs)' }],
        });
      } catch {
        router.replace('/(tabs)/home');
      }
    }
  }, [profile?.onboardingCompleted, navigation, router]);

  const [notificationStatus, setNotificationStatus] = useState<PermissionStatus>('not_determined');
  const [exactAlarmStatus, setExactAlarmStatus] = useState<PermissionStatus>('not_determined');
  const [fullScreenIntentStatus, setFullScreenIntentStatus] =
    useState<PermissionStatus>('not_determined');
  const [batteryStatus, setBatteryStatus] = useState<PermissionStatus>('not_determined');
  const [cameraStatus, setCameraStatus] = useState<PermissionStatus>('not_determined');
  const [photoStatus, setPhotoStatus] = useState<PermissionStatus>('not_determined');

  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const checkAllPermissions = useCallback(async () => {
    // 1. Medicine notifications (Required)
    try {
      const notif = await Notifications.getPermissionsAsync();
      if (notif.granted || notif.status === 'granted') {
        setNotificationStatus('granted');
      } else if (!notif.canAskAgain) {
        setNotificationStatus('needs_settings');
      } else if (notif.status === 'denied') {
        setNotificationStatus('denied');
      } else {
        setNotificationStatus('not_determined');
      }
    } catch {
      setNotificationStatus('denied');
    }

    // 2. Precise reminders / Exact alarms (Android)
    if (Platform.OS === 'android') {
      try {
        const canExact = await nativeAlarmService.canScheduleExactAlarms();
        setExactAlarmStatus(canExact ? 'granted' : 'needs_settings');
      } catch {
        setExactAlarmStatus('needs_settings');
      }
    } else {
      setExactAlarmStatus('granted'); // Implicitly supported on iOS
    }

    // 3. Full-screen alarm UI access (Android 14+)
    if (Platform.OS === 'android') {
      try {
        const canUseFullScreenIntent = await nativeAlarmService.canUseFullScreenIntent();
        setFullScreenIntentStatus(canUseFullScreenIntent ? 'granted' : 'needs_settings');
      } catch {
        setFullScreenIntentStatus('needs_settings');
      }
    } else {
      setFullScreenIntentStatus('granted');
    }

    // 4. Alarm reliability / Battery optimization exemption (Android)
    if (Platform.OS === 'android') {
      try {
        const rel = await batteryOptimizationService.getReliabilityStatus();
        setBatteryStatus(rel.isIgnoringBatteryOptimizations ? 'granted' : 'not_determined');
      } catch {
        setBatteryStatus('not_determined');
      }
    } else {
      setBatteryStatus('granted');
    }

    // 5. Camera access (Optional)
    try {
      const cam = await Camera.getCameraPermissionsAsync();
      if (cam.granted || cam.status === 'granted') {
        setCameraStatus('granted');
      } else if (!cam.canAskAgain) {
        setCameraStatus('needs_settings');
      } else if (cam.status === 'denied') {
        setCameraStatus('denied');
      } else {
        setCameraStatus('not_determined');
      }
    } catch {
      setCameraStatus('unavailable');
    }

    // 6. Photos and media (Optional)
    try {
      const photos = await ImagePicker.getMediaLibraryPermissionsAsync();
      if (photos.granted || photos.status === 'granted') {
        setPhotoStatus('granted');
      } else if (!photos.canAskAgain) {
        setPhotoStatus('needs_settings');
      } else if (photos.status === 'denied') {
        setPhotoStatus('denied');
      } else {
        setPhotoStatus('not_determined');
      }
    } catch {
      setPhotoStatus('unavailable');
    }
  }, []);

  // Re-check when screen mounts and whenever app returns to foreground
  useEffect(() => {
    checkAllPermissions();

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        checkAllPermissions();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [checkAllPermissions]);

  // Re-check when returning from Android Settings or other routes
  useFocusEffect(
    useCallback(() => {
      checkAllPermissions();
    }, [checkAllPermissions]),
  );

  const handleToggleNotifications = async () => {
    if (notificationStatus === 'granted') {
      Alert.alert(
        'Already Allowed',
        'Medicine notifications are enabled. You will receive dose reminders as scheduled.',
      );
      return;
    }

    setLoadingKey('notifications');
    try {
      const result = await Notifications.requestPermissionsAsync();
      if (result.granted || result.status === 'granted') {
        setNotificationStatus('granted');
      } else if (!result.canAskAgain) {
        setNotificationStatus('needs_settings');
        Alert.alert(
          'Notifications Required',
          "Notification access is needed to alert you when it's time for your medication. Please allow notifications in device settings.",
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ],
        );
      } else {
        setNotificationStatus('denied');
      }
    } catch {
      Linking.openSettings();
    } finally {
      setLoadingKey(null);
    }
  };

  const handleToggleExactAlarm = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Precise Timing',
        'Exact hardware reminder triggers are natively managed by your device.',
      );
      return;
    }

    if (exactAlarmStatus === 'granted') {
      Alert.alert(
        'Already Allowed',
        'Exact alarm permissions are active for zero-latency medicine alarms.',
      );
      return;
    }

    setLoadingKey('exact');
    try {
      await nativeAlarmService.openExactAlarmSettings();
    } catch {
      Linking.openSettings();
    } finally {
      setLoadingKey(null);
    }
  };

  const handleToggleFullScreenIntent = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Full-screen alarms',
        'Full-screen alarm presentation is managed by the operating system on this device.',
      );
      return;
    }

    if (fullScreenIntentStatus === 'granted') {
      Alert.alert(
        'Already Allowed',
        'HealthMate can open the alarm screen when a medicine reminder rings.',
      );
      return;
    }

    setLoadingKey('fullScreen');
    try {
      await nativeAlarmService.openFullScreenIntentSettings();
      setTimeout(checkAllPermissions, 1200);
    } catch {
      Linking.openSettings();
    } finally {
      setLoadingKey(null);
    }
  };

  const handleToggleBatteryOptimization = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Alarm Reliability',
        'iOS manages background dose alarms natively without battery kill restrictions.',
      );
      return;
    }

    if (batteryStatus === 'granted') {
      Alert.alert(
        'Already Optimized',
        'HealthMate is exempt from battery saver restrictions, ensuring high-reliability alarms.',
        [
          {
            text: 'OEM Guide',
            onPress: () => router.push('/settings/battery-optimization' as any),
          },
          { text: 'OK', style: 'default' },
        ],
      );
      return;
    }

    setLoadingKey('battery');
    try {
      await batteryOptimizationService.requestIgnoreBatteryOptimizations();
      setTimeout(checkAllPermissions, 1500);
    } catch (error) {
      console.warn('Battery exemption request error:', error);
      router.push('/settings/battery-optimization' as any);
    } finally {
      setLoadingKey(null);
    }
  };

  const handleToggleCamera = async () => {
    if (cameraStatus === 'granted') {
      Alert.alert(
        'Already Allowed',
        'Camera access is active for scanning medication labels and barcodes.',
      );
      return;
    }

    setLoadingKey('camera');
    try {
      const result = await Camera.requestCameraPermissionsAsync();
      if (result.granted || result.status === 'granted') {
        setCameraStatus('granted');
      } else if (!result.canAskAgain) {
        setCameraStatus('needs_settings');
        Alert.alert(
          'Camera Access',
          'Camera access is needed to scan medication boxes and prescription labels. You can enable it in device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ],
        );
      } else {
        setCameraStatus('denied');
      }
    } catch {
      Linking.openSettings();
    } finally {
      setLoadingKey(null);
    }
  };

  const handleTogglePhotos = async () => {
    if (photoStatus === 'granted') {
      Alert.alert(
        'Already Allowed',
        'Photo gallery access is active for importing prescription images.',
      );
      return;
    }

    setLoadingKey('photos');
    try {
      const result = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (result.granted || result.status === 'granted') {
        setPhotoStatus('granted');
      } else if (!result.canAskAgain) {
        setPhotoStatus('needs_settings');
        Alert.alert(
          'Photo Access',
          'Photo library access is needed to select medication images from your gallery. You can enable it in device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ],
        );
      } else {
        setPhotoStatus('denied');
      }
    } catch {
      Linking.openSettings();
    } finally {
      setLoadingKey(null);
    }
  };

  const isNotificationsGranted = notificationStatus === 'granted';

  const handleFinish = () => {
    if (!isNotificationsGranted) return;
    completeOnboarding();
    try {
      navigation.reset({
        index: 0,
        routes: [{ name: '(tabs)' }],
      });
    } catch {
      if (router.canDismiss()) {
        router.dismissAll();
      }
      router.replace('/(tabs)/home');
    }
  };

  return (
    <AppScreen scrollable={false} contentContainerStyle={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Top Navigation Row: Back Button */}
        <View style={styles.topNavRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back to profile setup"
          >
            <Ionicons name="chevron-back" size={24} color="#0F172A" />
          </TouchableOpacity>
        </View>

        {/* Header Title with Health & Security Badge */}
        <View style={styles.headerRow}>
          <View style={styles.headerTextGroup}>
            <Text style={styles.stepIndicator}>STEP 3 OF 3</Text>
            <Text style={styles.screenTitle}>Set up permissions</Text>
            <Text style={styles.screenSubtitle}>
              Enable notifications so HealthMate can alert you when it's time for your medication.
            </Text>
          </View>

          <View style={styles.headerIconContainer}>
            <MaterialCommunityIcons name="shield-check" size={30} color={Colors.primary} />
          </View>
        </View>

        {/* Interactive Permission Cards List */}
        <View style={styles.cardsList}>
          {/* 1. Medicine Notifications (Mandatory / Required) */}
          <TouchableOpacity
            style={[styles.card, isNotificationsGranted && styles.cardGranted]}
            onPress={handleToggleNotifications}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Medicine notifications permission, required"
          >
            <View
              style={[
                styles.iconBox,
                isNotificationsGranted ? styles.iconBoxGranted : styles.iconBoxPrimary,
              ]}
            >
              <Feather
                name="bell"
                size={22}
                color={isNotificationsGranted ? Colors.successDark : Colors.primary}
              />
            </View>

            <View style={styles.cardContent}>
              <View style={styles.cardHeaderLine}>
                <Text style={styles.cardTitle}>Medicine notifications</Text>
                <View style={[styles.priorityBadge, styles.priorityRequired]}>
                  <Text style={[styles.priorityBadgeText, styles.priorityRequiredText]}>
                    Required
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDescription}>
                Receive alert sounds and reminders when it is time to take a dose.
              </Text>

              <View style={styles.statusRow}>
                {loadingKey === 'notifications' ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : isNotificationsGranted ? (
                  <View style={styles.statusPillAllowed}>
                    <Ionicons name="checkmark-circle" size={15} color={Colors.successDark} />
                    <Text style={styles.statusPillAllowedText}>Allowed</Text>
                  </View>
                ) : notificationStatus === 'needs_settings' ? (
                  <View style={styles.statusPillSettings}>
                    <Ionicons name="open-outline" size={13} color={Colors.primary} />
                    <Text style={styles.statusPillActionText}>Open Settings</Text>
                  </View>
                ) : (
                  <View style={styles.statusPillAction}>
                    <Feather name="arrow-right" size={13} color={Colors.primary} />
                    <Text style={styles.statusPillActionText}>Tap to enable</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>

          {/* 2. Precise Reminders / Exact Alarms (Recommended) */}
          <TouchableOpacity
            style={[styles.card, exactAlarmStatus === 'granted' && styles.cardGranted]}
            onPress={handleToggleExactAlarm}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Precise reminders permission, recommended"
          >
            <View
              style={[
                styles.iconBox,
                exactAlarmStatus === 'granted' ? styles.iconBoxGranted : styles.iconBoxPrimary,
              ]}
            >
              <Feather
                name="clock"
                size={22}
                color={exactAlarmStatus === 'granted' ? Colors.successDark : Colors.primary}
              />
            </View>

            <View style={styles.cardContent}>
              <View style={styles.cardHeaderLine}>
                <Text style={styles.cardTitle}>Precise reminders</Text>
                <View style={[styles.priorityBadge, styles.priorityRecommended]}>
                  <Text style={[styles.priorityBadgeText, styles.priorityRecommendedText]}>
                    Recommended
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDescription}>
                Hardware exact-alarm scheduling to wake your device on time during deep sleep.
              </Text>

              <View style={styles.statusRow}>
                {loadingKey === 'exact' ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : exactAlarmStatus === 'granted' ? (
                  <View style={styles.statusPillAllowed}>
                    <Ionicons name="checkmark-circle" size={15} color={Colors.successDark} />
                    <Text style={styles.statusPillAllowedText}>Allowed</Text>
                  </View>
                ) : (
                  <View style={styles.statusPillSettings}>
                    <Ionicons name="open-outline" size={13} color={Colors.primary} />
                    <Text style={styles.statusPillActionText}>Open Settings</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>

          {/* 3. Full-screen Alarm UI (Required for direct alarm screen launch) */}
          <TouchableOpacity
            style={[styles.card, fullScreenIntentStatus === 'granted' && styles.cardGranted]}
            onPress={handleToggleFullScreenIntent}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Full-screen alarm screen permission, required"
          >
            <View
              style={[
                styles.iconBox,
                fullScreenIntentStatus === 'granted'
                  ? styles.iconBoxGranted
                  : styles.iconBoxPrimary,
              ]}
            >
              <MaterialCommunityIcons
                name="fullscreen"
                size={22}
                color={fullScreenIntentStatus === 'granted' ? Colors.successDark : Colors.primary}
              />
            </View>

            <View style={styles.cardContent}>
              <View style={styles.cardHeaderLine}>
                <Text style={styles.cardTitle}>Full-screen alarm screen</Text>
                <View style={[styles.priorityBadge, styles.priorityRequired]}>
                  <Text style={[styles.priorityBadgeText, styles.priorityRequiredText]}>
                    Required
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDescription}>
                Open the alarm screen automatically when a dose is due instead of only showing a
                notification.
              </Text>

              <View style={styles.statusRow}>
                {loadingKey === 'fullScreen' ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : fullScreenIntentStatus === 'granted' ? (
                  <View style={styles.statusPillAllowed}>
                    <Ionicons name="checkmark-circle" size={15} color={Colors.successDark} />
                    <Text style={styles.statusPillAllowedText}>Allowed</Text>
                  </View>
                ) : (
                  <View style={styles.statusPillSettings}>
                    <Ionicons name="open-outline" size={13} color={Colors.primary} />
                    <Text style={styles.statusPillActionText}>Open Settings</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>

          {/* 4. Alarm Reliability / Battery Exemption (Recommended) */}
          <TouchableOpacity
            style={[styles.card, batteryStatus === 'granted' && styles.cardGranted]}
            onPress={handleToggleBatteryOptimization}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Alarm reliability and battery optimization, recommended"
          >
            <View
              style={[
                styles.iconBox,
                batteryStatus === 'granted' ? styles.iconBoxGranted : styles.iconBoxPrimary,
              ]}
            >
              <MaterialCommunityIcons
                name="battery-heart-variant"
                size={22}
                color={batteryStatus === 'granted' ? Colors.successDark : Colors.primary}
              />
            </View>

            <View style={styles.cardContent}>
              <View style={styles.cardHeaderLine}>
                <Text style={styles.cardTitle}>Alarm reliability</Text>
                <View style={[styles.priorityBadge, styles.priorityRecommended]}>
                  <Text style={[styles.priorityBadgeText, styles.priorityRecommendedText]}>
                    Recommended
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDescription}>
                Exempt HealthMate from battery restrictions so background alarms fire without OS delays.
              </Text>

              <View style={styles.statusRow}>
                {loadingKey === 'battery' ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : batteryStatus === 'granted' ? (
                  <View style={styles.statusPillAllowed}>
                    <Ionicons name="checkmark-circle" size={15} color={Colors.successDark} />
                    <Text style={styles.statusPillAllowedText}>Allowed</Text>
                  </View>
                ) : (
                  <View style={styles.statusPillSettings}>
                    <Ionicons name="shield-checkmark-outline" size={13} color={Colors.primary} />
                    <Text style={styles.statusPillActionText}>Optimize Reliability</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>

          {/* 3. Camera Access (Optional) */}
          <TouchableOpacity
            style={[styles.card, cameraStatus === 'granted' && styles.cardGranted]}
            onPress={handleToggleCamera}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Camera access permission, optional"
          >
            <View
              style={[
                styles.iconBox,
                cameraStatus === 'granted' ? styles.iconBoxGranted : styles.iconBoxNeutral,
              ]}
            >
              <Ionicons
                name="camera-outline"
                size={22}
                color={cameraStatus === 'granted' ? Colors.successDark : Colors.textSecondary}
              />
            </View>

            <View style={styles.cardContent}>
              <View style={styles.cardHeaderLine}>
                <Text style={styles.cardTitle}>Camera access</Text>
                <View style={[styles.priorityBadge, styles.priorityOptional]}>
                  <Text style={[styles.priorityBadgeText, styles.priorityOptionalText]}>
                    Optional
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDescription}>
                Scan medication boxes, prescription labels, and batch barcodes with AI.
              </Text>

              <View style={styles.statusRow}>
                {loadingKey === 'camera' ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : cameraStatus === 'granted' ? (
                  <View style={styles.statusPillAllowed}>
                    <Ionicons name="checkmark-circle" size={15} color={Colors.successDark} />
                    <Text style={styles.statusPillAllowedText}>Allowed</Text>
                  </View>
                ) : cameraStatus === 'needs_settings' ? (
                  <View style={styles.statusPillSettings}>
                    <Ionicons name="open-outline" size={13} color={Colors.primary} />
                    <Text style={styles.statusPillActionText}>Open Settings</Text>
                  </View>
                ) : (
                  <View style={styles.statusPillAction}>
                    <Feather name="plus-circle" size={13} color={Colors.primary} />
                    <Text style={styles.statusPillActionText}>Tap to enable</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>

          {/* 4. Photos & Images (Optional) */}
          <TouchableOpacity
            style={[styles.card, photoStatus === 'granted' && styles.cardGranted]}
            onPress={handleTogglePhotos}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Photos and gallery access permission, optional"
          >
            <View
              style={[
                styles.iconBox,
                photoStatus === 'granted' ? styles.iconBoxGranted : styles.iconBoxNeutral,
              ]}
            >
              <Ionicons
                name="images-outline"
                size={22}
                color={photoStatus === 'granted' ? Colors.successDark : Colors.textSecondary}
              />
            </View>

            <View style={styles.cardContent}>
              <View style={styles.cardHeaderLine}>
                <Text style={styles.cardTitle}>Photos & gallery</Text>
                <View style={[styles.priorityBadge, styles.priorityOptional]}>
                  <Text style={[styles.priorityBadgeText, styles.priorityOptionalText]}>
                    Optional
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDescription}>
                Attach pill packaging or prescription images directly from your gallery.
              </Text>

              <View style={styles.statusRow}>
                {loadingKey === 'photos' ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : photoStatus === 'granted' ? (
                  <View style={styles.statusPillAllowed}>
                    <Ionicons name="checkmark-circle" size={15} color={Colors.successDark} />
                    <Text style={styles.statusPillAllowedText}>Allowed</Text>
                  </View>
                ) : photoStatus === 'needs_settings' ? (
                  <View style={styles.statusPillSettings}>
                    <Ionicons name="open-outline" size={13} color={Colors.primary} />
                    <Text style={styles.statusPillActionText}>Open Settings</Text>
                  </View>
                ) : (
                  <View style={styles.statusPillAction}>
                    <Feather name="plus-circle" size={13} color={Colors.primary} />
                    <Text style={styles.statusPillActionText}>Tap to enable</Text>
                  </View>
                )}
              </View>
            </View>
          </TouchableOpacity>
        </View>

        {/* Action Section: Continue Button */}
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={[
              styles.continueButton,
              isNotificationsGranted ? styles.continueButtonActive : styles.continueButtonDisabled,
            ]}
            onPress={handleFinish}
            disabled={!isNotificationsGranted}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Continue to HealthMate dashboard"
            accessibilityState={{ disabled: !isNotificationsGranted }}
          >
            <View style={styles.buttonInner}>
              <Text
                style={[
                  styles.continueButtonText,
                  !isNotificationsGranted && styles.continueButtonTextDisabled,
                ]}
              >
                Continue
              </Text>
              <Feather
                name="arrow-right"
                size={18}
                color={isNotificationsGranted ? '#FFFFFF' : '#94A3B8'}
                style={styles.arrowIcon}
              />
            </View>
          </TouchableOpacity>

          {/* Validation / Status Helper Message */}
          <View style={styles.requirementNotice}>
            {isNotificationsGranted ? (
              <View style={styles.noticeRow}>
                <Ionicons name="checkmark-circle" size={15} color={Colors.successDark} />
                <Text style={styles.noticeTextSuccess}>Required notification access granted</Text>
              </View>
            ) : (
              <View style={styles.noticeRow}>
                <Feather name="alert-circle" size={14} color={Colors.warningDark} />
                <Text style={styles.noticeTextWarning}>
                  Allow medicine notifications above to continue
                </Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FD',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xl,
  },
  topNavRow: {
    paddingVertical: 4,
    marginBottom: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerTextGroup: {
    flex: 1,
    paddingRight: 10,
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  screenTitle: {
    fontSize: 27,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
    lineHeight: 32,
    marginBottom: 6,
  },
  screenSubtitle: {
    fontSize: 14,
    color: '#64748B',
    lineHeight: 20,
  },
  headerIconContainer: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  cardsList: {
    gap: 12,
    marginBottom: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.card,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardGranted: {
    borderColor: '#D1FAE5',
    backgroundColor: '#FCFDFD',
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  iconBoxPrimary: {
    backgroundColor: Colors.primaryLight,
  },
  iconBoxNeutral: {
    backgroundColor: '#F1F5F9',
  },
  iconBoxGranted: {
    backgroundColor: Colors.successLight,
  },
  cardContent: {
    flex: 1,
  },
  cardHeaderLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
    marginRight: 8,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  priorityBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  priorityRequired: {
    backgroundColor: Colors.primaryLight,
  },
  priorityRequiredText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  priorityRecommended: {
    backgroundColor: '#FEF3C7',
  },
  priorityRecommendedText: {
    color: '#B45309',
    fontSize: 11,
    fontWeight: '700',
  },
  priorityOptional: {
    backgroundColor: '#F1F5F9',
  },
  priorityOptionalText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  cardDescription: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    marginBottom: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusPillAllowed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.successLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  statusPillAllowedText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.successDark,
  },
  statusPillAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  statusPillSettings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  statusPillActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primary,
  },
  statusPillNeutral: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  statusPillNeutralText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#94A3B8',
  },
  actionSection: {
    marginTop: 4,
    alignItems: 'center',
  },
  continueButton: {
    width: '100%',
    height: 52,
    borderRadius: Radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  continueButtonActive: {
    backgroundColor: Colors.primary,
  },
  continueButtonDisabled: {
    backgroundColor: '#CBD5E1',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  continueButtonTextDisabled: {
    color: '#64748B',
  },
  arrowIcon: {
    marginLeft: 8,
  },
  requirementNotice: {
    marginTop: 12,
    alignItems: 'center',
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  noticeTextSuccess: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.successDark,
  },
  noticeTextWarning: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.warningDark,
  },
  batteryGuideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.card,
    marginTop: -2,
    marginBottom: 4,
    gap: 8,
  },
  batteryGuideText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
});
