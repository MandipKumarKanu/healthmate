import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Animated,
  PanResponder,
  Dimensions,
  Vibration,
  Platform,
  useColorScheme,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { nativeAlarmService } from '../services/nativeAlarmService';
import { adherenceRepository } from '../database/repositories/adherenceRepository';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { useAppStore } from '../store/appStore';
import { Colors } from '../theme/colors';
import { Radius, Spacing, Typography } from '../theme/tokens';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SLIDER_WIDTH = Math.min(SCREEN_WIDTH - 44, 350);
const PUCK_SIZE = 58;
const MAX_DRAG = (SLIDER_WIDTH - PUCK_SIZE) / 2 - 6;
const SWIPE_THRESHOLD = MAX_DRAG * 0.7;

export default function FullScreenAlarmScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const params = useLocalSearchParams<{
    scheduleId?: string;
    medicineName?: string;
    amount?: string;
    time?: string;
    label?: string;
  }>();

  const { preferences } = useAppStore();
  const snoozeMinutes = preferences?.snoozeIntervalMinutes || 10;

  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [completedAction, setCompletedAction] = useState<'taken' | 'snooze' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Resolve medication and schedule details safely via useMemo
  const medDetails = useMemo(() => {
    const sId = params.scheduleId ?? '';
    let mName = params.medicineName ?? 'Medication';
    let amt = params.amount ?? '1 dose';
    let dTime = params.time ?? '';
    let dLabel = params.label ?? '';
    let mId = '';
    let dForm = '';

    if (sId) {
      const sched = scheduleRepository.getById(sId);
      if (sched) {
        mId = sched.medicineId;
        const med = medicineRepository.getById(sched.medicineId);
        if (med) {
          mName = med.name;
          dForm = med.dosageForm || '';
          if (med.strength) amt = `${med.strength} · ${amt}`;
        }
        if (!dTime && sched.times.length > 0) {
          dTime = sched.times[0].time;
          dLabel = sched.times[0].label ?? dLabel;
        }
      }
    }

    if (!mId && mName) {
      const matched = medicineRepository
        .getAll()
        .find((m) => m.name.toLowerCase() === mName.toLowerCase());
      if (matched) {
        mId = matched.id;
        if (!dForm) dForm = matched.dosageForm || '';
      }
    }

    return {
      scheduleId: sId,
      medicineId: mId,
      medicineName: mName,
      amount: amt,
      doseTime: dTime,
      doseLabel: dLabel,
      dosageForm: dForm,
    };
  }, [params.scheduleId, params.medicineName, params.amount, params.time, params.label]);

  const { scheduleId, medicineId, medicineName, amount, doseTime, doseLabel, dosageForm } =
    medDetails;

  // Animation values
  const [panX] = useState(() => new Animated.Value(0));
  const [chimeScale] = useState(() => new Animated.Value(1));
  const [chimeTilt] = useState(() => new Animated.Value(0));

  // Clock ticker & native lockscreen keyguard unlock
  useEffect(() => {
    nativeAlarmService.dismissKeyguard();

    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
      setCurrentDate(
        now.toLocaleDateString([], {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        }),
      );
    };

    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  // Subtle breathing chime animation (gentle and soothing, not blinding)
  useEffect(() => {
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(chimeScale, {
          toValue: 1.08,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(chimeScale, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
      ]),
    );

    const tiltAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(chimeTilt, {
          toValue: -8,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(chimeTilt, {
          toValue: 8,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(chimeTilt, {
          toValue: -4,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(chimeTilt, {
          toValue: 4,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.timing(chimeTilt, {
          toValue: 0,
          duration: 120,
          useNativeDriver: true,
        }),
        Animated.delay(1800),
      ]),
    );

    pulseAnim.start();
    tiltAnim.start();

    return () => {
      pulseAnim.stop();
      tiltAnim.stop();
      nativeAlarmService.stopAlarm();
    };
  }, [chimeScale, chimeTilt]);

  // Swipe Action: Take Dose (Swipe Right)
  const executeTakeDose = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorMessage(null);

    // Smooth glide to right edge
    Animated.timing(panX, {
      toValue: MAX_DRAG,
      duration: 180,
      useNativeDriver: true,
    }).start();

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 60, 40, 60] : 100);
      setCompletedAction('taken');
      await nativeAlarmService.stopAlarm();

      if (scheduleId && medicineId) {
        const now = new Date();
        const todayStr = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0'),
        ].join('-');

        const targetTime =
          doseTime ||
          `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        try {
          adherenceRepository.logDoseStatus(scheduleId, medicineId, todayStr, targetTime, 'taken');
        } catch (logErr) {
          console.warn('Could not record dose adherence log:', logErr);
        }
      }

      setTimeout(() => {
        router.replace('/(tabs)/home');
      }, 750);
    } catch (e) {
      console.warn('Failed to record taken dose:', e);
      setErrorMessage('Could not complete action. Please try again.');
      setIsProcessing(false);
      setCompletedAction(null);
      Animated.spring(panX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 8,
      }).start();
    }
  }, [isProcessing, panX, scheduleId, medicineId, doseTime, router]);

  // Swipe Action: Snooze Alarm (Swipe Left)
  const executeSnooze = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorMessage(null);

    // Smooth glide to left edge
    Animated.timing(panX, {
      toValue: -MAX_DRAG,
      duration: 180,
      useNativeDriver: true,
    }).start();

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 40, 40, 80] : 100);
      setCompletedAction('snooze');

      await nativeAlarmService.snoozeAlarm({
        scheduleId,
        medicineName,
        amount,
        time: doseTime,
        label: doseLabel,
        minutes: snoozeMinutes,
      });

      setTimeout(() => {
        router.replace('/(tabs)/home');
      }, 750);
    } catch (e) {
      console.warn('Failed to snooze alarm:', e);
      setErrorMessage('Could not snooze alarm. Please try again.');
      setIsProcessing(false);
      setCompletedAction(null);
      Animated.spring(panX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 8,
      }).start();
    }
  }, [
    isProcessing,
    panX,
    scheduleId,
    medicineName,
    amount,
    doseTime,
    doseLabel,
    snoozeMinutes,
    router,
  ]);

  // Tactile PanResponder for the single physical slider
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isProcessing,
        onMoveShouldSetPanResponder: (_, gesture) => !isProcessing && Math.abs(gesture.dx) > 6,
        onPanResponderMove: (_, gestureState) => {
          if (isProcessing) return;

          // Non-linear damping near the ends for realistic physical resistance
          let dx = gestureState.dx;
          if (Math.abs(dx) > MAX_DRAG) {
            const overflow = Math.abs(dx) - MAX_DRAG;
            dx = (dx > 0 ? 1 : -1) * (MAX_DRAG + overflow * 0.22);
          }

          panX.setValue(dx);

          // Threshold haptic feedback tick attached to the active gesture
          const gs = gestureState as { dx: number; hasTriggeredHaptic?: boolean };
          if (Math.abs(dx) >= SWIPE_THRESHOLD && !gs.hasTriggeredHaptic) {
            gs.hasTriggeredHaptic = true;
            try {
              Vibration.vibrate(Platform.OS === 'android' ? 25 : 40);
            } catch (_) {}
          } else if (Math.abs(dx) < SWIPE_THRESHOLD && gs.hasTriggeredHaptic) {
            gs.hasTriggeredHaptic = false;
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (isProcessing) return;

          if (gestureState.dx >= SWIPE_THRESHOLD) {
            executeTakeDose();
          } else if (gestureState.dx <= -SWIPE_THRESHOLD) {
            executeSnooze();
          } else {
            // Smooth spring return to center
            Animated.spring(panX, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 8,
              speed: 14,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          if (!isProcessing) {
            Animated.spring(panX, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 8,
            }).start();
          }
        },
      }),
    [isProcessing, panX, executeTakeDose, executeSnooze],
  );

  const bellRotation = chimeTilt.interpolate({
    inputRange: [-10, 10],
    outputRange: ['-10deg', '10deg'],
  });

  const greenFillOpacity = panX.interpolate({
    inputRange: [0, MAX_DRAG],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const amberFillOpacity = panX.interpolate({
    inputRange: [-MAX_DRAG, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const themeColors = {
    bg: isDark ? '#121217' : Colors.background,
    cardBg: isDark ? '#1C1C24' : Colors.cardBackground,
    cardBorder: isDark ? '#2A2A36' : Colors.border,
    textPrimary: isDark ? '#F4F4F6' : Colors.textPrimary,
    textSecondary: isDark ? '#9E9EA8' : Colors.textSecondary,
    trackBg: isDark ? '#242430' : '#E8E7ED',
    trackBorder: isDark ? '#323242' : '#DDDCDE',
    puckBg: isDark ? '#2E2E3C' : '#FFFFFF',
    puckBorder: isDark ? '#3E3E50' : '#D4D3D8',
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safeArea}>
        {/* Top Brand Tag & Live Clock Header */}
        <View style={styles.header}>
          <View style={styles.brandBadge}>
            <Ionicons name="medkit" size={14} color={Colors.primary} />
            <Text style={styles.brandBadgeText}>HealthMate Reminder</Text>
          </View>
          <Text style={[styles.clockText, { color: themeColors.textPrimary }]}>{currentTime}</Text>
          <Text style={[styles.dateText, { color: themeColors.textSecondary }]}>{currentDate}</Text>
        </View>

        {/* Medication Details Hero Card */}
        <View
          style={[
            styles.heroCard,
            {
              backgroundColor: themeColors.cardBg,
              borderColor: themeColors.cardBorder,
            },
          ]}
        >
          {/* Dose Scheduled Chip */}
          <View style={styles.scheduleChip}>
            <Ionicons name="time" size={14} color={Colors.primary} />
            <Text style={styles.scheduleChipText}>
              {doseLabel
                ? `${doseLabel} · ${doseTime}`
                : doseTime
                  ? `Scheduled at ${doseTime}`
                  : 'Medication Due'}
            </Text>
          </View>

          {/* Gentle Breathing Chime Indicator */}
          <View style={styles.chimeArea}>
            <Animated.View
              style={[
                styles.chimeHalo,
                {
                  transform: [{ scale: chimeScale }],
                },
              ]}
            />
            <View style={styles.chimeCircle}>
              <Animated.View style={{ transform: [{ rotate: bellRotation }] }}>
                <Ionicons name="notifications" size={36} color={Colors.primary} />
              </Animated.View>
            </View>
          </View>

          {/* Medication Name & Details */}
          <Text style={[styles.medName, { color: themeColors.textPrimary }]} numberOfLines={3}>
            {medicineName}
          </Text>
          <Text style={[styles.medAmount, { color: themeColors.textSecondary }]}>
            {dosageForm ? `${dosageForm.toUpperCase()} · ${amount}` : amount}
          </Text>
        </View>

        {/* Action Status Feedback Toast */}
        {completedAction && (
          <View
            style={[
              styles.actionToast,
              completedAction === 'taken' ? styles.actionToastTaken : styles.actionToastSnooze,
            ]}
          >
            <Ionicons
              name={completedAction === 'taken' ? 'checkmark-circle' : 'alarm'}
              size={20}
              color="#FFFFFF"
            />
            <Text style={styles.actionToastText}>
              {completedAction === 'taken'
                ? 'Dose Recorded as Taken'
                : `Snoozed for ${snoozeMinutes} Minutes`}
            </Text>
          </View>
        )}

        {/* Error Notification */}
        {errorMessage && (
          <View style={styles.errorToast}>
            <Ionicons name="alert-circle" size={18} color={Colors.error} />
            <Text style={styles.errorToastText}>{errorMessage}</Text>
          </View>
        )}

        {/* Single Primary Interaction: Physical Swipe Control */}
        <View style={styles.sliderContainer}>
          <View
            style={[
              styles.sliderTrack,
              {
                backgroundColor: themeColors.trackBg,
                borderColor: themeColors.trackBorder,
              },
            ]}
          >
            {/* Left Amber Snooze Fill */}
            <Animated.View
              style={[styles.sliderFill, styles.sliderFillAmber, { opacity: amberFillOpacity }]}
            />
            {/* Right Green Take Fill */}
            <Animated.View
              style={[styles.sliderFill, styles.sliderFillGreen, { opacity: greenFillOpacity }]}
            />

            {/* Left and Right Target Labels */}
            <View style={styles.sliderLabelsLayer} pointerEvents="none">
              <View style={styles.sliderLabelGroupLeft}>
                <Ionicons name="alarm-outline" size={18} color="#D97706" />
                <Text style={styles.sliderLabelLeftText}>Snooze {snoozeMinutes}m</Text>
              </View>
              <View style={styles.sliderLabelGroupRight}>
                <Text style={styles.sliderLabelRightText}>Take Dose</Text>
                <Ionicons name="checkmark-circle-outline" size={18} color="#059669" />
              </View>
            </View>

            {/* Draggable Puck (Center Handle) */}
            <Animated.View
              {...panResponder.panHandlers}
              style={[
                styles.sliderPuck,
                {
                  backgroundColor: themeColors.puckBg,
                  borderColor: themeColors.puckBorder,
                  transform: [{ translateX: panX }],
                },
              ]}
            >
              <Ionicons name="swap-horizontal" size={26} color={Colors.primary} />
            </Animated.View>
          </View>

          {/* Clean Guidance Hint */}
          <Text style={[styles.sliderHint, { color: themeColors.textSecondary }]}>
            Swipe right to take • Swipe left to snooze
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.screenPaddingHorizontal,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginTop: Spacing.xs,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    marginBottom: 8,
  },
  brandBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primaryDark,
    letterSpacing: 0.2,
  },
  clockText: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  dateText: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  heroCard: {
    width: '100%',
    borderRadius: Radius.card,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    marginVertical: Spacing.sm,
  },
  scheduleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    marginBottom: 16,
  },
  scheduleChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  chimeArea: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 88,
    height: 88,
    marginVertical: 4,
  },
  chimeHalo: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.primaryLight,
  },
  chimeCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(7, 136, 245, 0.25)',
  },
  medName: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 4,
    lineHeight: 30,
  },
  medAmount: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  actionToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    marginVertical: 4,
  },
  actionToastTaken: {
    backgroundColor: Colors.success,
  },
  actionToastSnooze: {
    backgroundColor: Colors.warning,
  },
  actionToastText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  errorToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.errorLight,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    marginVertical: 4,
  },
  errorToastText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.errorDark,
  },
  sliderContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sliderTrack: {
    width: SLIDER_WIDTH,
    height: 66,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  sliderFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
  },
  sliderFillAmber: {
    left: 0,
    backgroundColor: '#FEF3C7',
  },
  sliderFillGreen: {
    right: 0,
    backgroundColor: '#D1FAE5',
  },
  sliderLabelsLayer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  sliderLabelGroupLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sliderLabelLeftText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
  },
  sliderLabelGroupRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sliderLabelRightText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#047857',
  },
  sliderPuck: {
    width: PUCK_SIZE,
    height: PUCK_SIZE,
    borderRadius: PUCK_SIZE / 2,
    position: 'absolute',
    left: (SLIDER_WIDTH - PUCK_SIZE) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 5,
  },
  sliderHint: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 10,
    letterSpacing: 0.1,
  },
});
