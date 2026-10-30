import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  TouchableOpacity,
  ScrollView,
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
import { Radius, Spacing } from '../theme/tokens';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SLIDER_WIDTH = Math.min(SCREEN_WIDTH - 44, 350);
const PUCK_SIZE = 58;
const MAX_DRAG = (SLIDER_WIDTH - PUCK_SIZE) / 2 - 6;
const SWIPE_THRESHOLD = MAX_DRAG * 0.7;

export interface ActiveDoseItem {
  id: string;
  scheduleId: string;
  medicineId: string;
  medicineName: string;
  amount: string;
  doseTime: string;
  doseLabel: string;
  dosageForm?: string;
  instanceId?: string;
  sourceScheduleId?: string;
  status: 'pending' | 'taken' | 'snoozed';
}

function resolveDoseItem(
  scheduleId: string,
  sourceScheduleId?: string,
  medicineName?: string,
  amount?: string,
  doseTime?: string,
  doseLabel?: string,
  instanceId?: string,
): ActiveDoseItem {
  const sId = sourceScheduleId || scheduleId || '';
  let mName = medicineName ?? 'Medication';
  let amt = amount ?? '1 dose';
  let dTime = doseTime ?? '';
  let dLabel = doseLabel ?? '';
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

  const id = `${sId || mId || mName}_${dTime || '00:00'}_${instanceId || ''}`;

  return {
    id,
    scheduleId: sId,
    medicineId: mId,
    medicineName: mName,
    amount: amt,
    doseTime: dTime,
    doseLabel: dLabel,
    dosageForm: dForm,
    instanceId,
    sourceScheduleId,
    status: 'pending',
  };
}

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
    instanceId?: string;
    sourceScheduleId?: string;
  }>();

  const { preferences } = useAppStore();
  const snoozeMinutes = preferences?.snoozeIntervalMinutes || 10;

  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');
  const [completedAction, setCompletedAction] = useState<'taken' | 'snooze' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Initialize initial dose from query parameters
  const initialDose = useMemo(() => {
    return resolveDoseItem(
      params.scheduleId || '',
      params.sourceScheduleId,
      params.medicineName,
      params.amount,
      params.time,
      params.label,
      params.instanceId,
    );
  }, [
    params.scheduleId,
    params.sourceScheduleId,
    params.medicineName,
    params.amount,
    params.time,
    params.label,
    params.instanceId,
  ]);

  const [doses, setDoses] = useState<ActiveDoseItem[]>([initialDose]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

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

  // Discover and aggregate simultaneous doses
  useEffect(() => {
    let isMounted = true;

    async function loadSimultaneousDoses() {
      const now = new Date();
      const todayStr = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');

      const doseMap = new Map<string, ActiveDoseItem>();
      doseMap.set(initialDose.id, initialDose);

      // 1. Fetch from active native alarms (AlarmService ringing alarms)
      try {
        const nativeAlarms = await nativeAlarmService.getActiveAlarms();
        for (const na of nativeAlarms) {
          const item = resolveDoseItem(
            na.scheduleId,
            na.sourceScheduleId,
            na.medicineName,
            na.amount,
            na.time,
            na.label,
            na.instanceId,
          );
          if (!doseMap.has(item.id)) {
            doseMap.set(item.id, item);
          }
        }
      } catch (_e) {}

      // 2. Fetch from adherence repository for today at initialDose.doseTime
      if (initialDose.doseTime) {
        try {
          const todayDoses = adherenceRepository.getDosesForDate(todayStr);
          for (const td of todayDoses) {
            if (
              td.time === initialDose.doseTime &&
              td.status !== 'taken' &&
              td.status !== 'skipped'
            ) {
              const item = resolveDoseItem(
                td.scheduleId,
                undefined,
                td.medicineName,
                td.amount,
                td.time,
                undefined,
                undefined,
              );
              if (!doseMap.has(item.id)) {
                doseMap.set(item.id, item);
              }
            }
          }
        } catch (_e) {}
      }

      if (isMounted) {
        setDoses(Array.from(doseMap.values()));
      }
    }

    loadSimultaneousDoses();

    return () => {
      isMounted = false;
    };
  }, [initialDose]);

  const currentDose = doses[selectedIndex] || doses[0];
  const pendingDoses = useMemo(() => doses.filter((d) => d.status === 'pending'), [doses]);

  // Gentle breathing chime animation
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
    };
  }, [chimeScale, chimeTilt]);

  // Swipe Action: Take Dose (Swipe Right)
  const executeTakeDose = useCallback(async () => {
    if (isProcessing || !currentDose) return;
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

      // Stop only this specific dose alarm natively, preserving remaining active doses
      await nativeAlarmService.stopAlarm(currentDose.scheduleId, currentDose.doseTime);
      if (currentDose.scheduleId) {
        await nativeAlarmService.cancelSnoozesForSchedule(currentDose.scheduleId);
      }

      // Record dose adherence log independently for this specific medication
      if (currentDose.scheduleId && currentDose.medicineId) {
        const now = new Date();
        const todayStr = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, '0'),
          String(now.getDate()).padStart(2, '0'),
        ].join('-');

        const targetTime =
          currentDose.doseTime ||
          `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

        try {
          adherenceRepository.logDoseStatus(
            currentDose.scheduleId,
            currentDose.medicineId,
            todayStr,
            targetTime,
            'taken',
          );
        } catch (logErr) {
          console.warn('Could not record dose adherence log:', logErr);
        }
      }

      const updated = doses.map((d) =>
        d.id === currentDose.id ? { ...d, status: 'taken' as const } : d,
      );
      setDoses(updated);

      const remainingPending = updated.filter((d) => d.status === 'pending');
      if (remainingPending.length > 0) {
        const nextIdx = updated.findIndex((d) => d.status === 'pending');
        setSelectedIndex(nextIdx);
        setToastMessage(`${currentDose.medicineName} recorded as taken`);
        setTimeout(() => setToastMessage(null), 2500);
        setIsProcessing(false);
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 6,
        }).start();
      } else {
        // All simultaneous doses completed
        setCompletedAction('taken');
        await nativeAlarmService.stopAlarm();
        setTimeout(() => {
          router.replace('/(tabs)/home');
        }, 750);
      }
    } catch (e) {
      console.warn('Failed to record taken dose:', e);
      setErrorMessage('Could not complete action. Please try again.');
      setIsProcessing(false);
      Animated.spring(panX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 8,
      }).start();
    }
  }, [isProcessing, currentDose, doses, panX, router]);

  // Swipe Action: Snooze Alarm (Swipe Left)
  const executeSnooze = useCallback(async () => {
    if (isProcessing || !currentDose) return;
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
      const snoozeResult = await nativeAlarmService.snoozeAlarm({
        scheduleId: currentDose.scheduleId,
        instanceId: currentDose.instanceId || `${currentDose.scheduleId}:${currentDose.doseTime}`,
        medicineName: currentDose.medicineName,
        amount: currentDose.amount,
        time: currentDose.doseTime,
        label: currentDose.doseLabel,
        minutes: snoozeMinutes,
      });

      if (!snoozeResult.success || !snoozeResult.data || snoozeResult.data <= Date.now()) {
        const errorMsg =
          snoozeResult.error?.code === 'exact_alarm_denied'
            ? 'Alarm permission missing. Cannot snooze.'
            : 'Could not snooze alarm. Please try again.';
        throw new Error(errorMsg);
      }

      await nativeAlarmService.stopAlarm(currentDose.scheduleId, currentDose.doseTime);

      const updated = doses.map((d) =>
        d.id === currentDose.id ? { ...d, status: 'snoozed' as const } : d,
      );
      setDoses(updated);

      const remainingPending = updated.filter((d) => d.status === 'pending');
      if (remainingPending.length > 0) {
        const nextIdx = updated.findIndex((d) => d.status === 'pending');
        setSelectedIndex(nextIdx);
        setToastMessage(`${currentDose.medicineName} snoozed for ${snoozeMinutes}m`);
        setTimeout(() => setToastMessage(null), 2500);
        setIsProcessing(false);
        Animated.spring(panX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 6,
        }).start();
      } else {
        setCompletedAction('snooze');
        setTimeout(() => {
          router.replace('/(tabs)/home');
        }, 750);
      }
    } catch (e: any) {
      console.warn('Failed to snooze alarm for schedule:', currentDose.scheduleId);
      setErrorMessage(e?.message || 'Could not snooze alarm. Please try again.');
      setIsProcessing(false);
      Animated.spring(panX, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 8,
      }).start();
    }
  }, [isProcessing, currentDose, doses, panX, snoozeMinutes, router]);

  // Action: Take All Pending Simultaneous Doses
  const executeTakeAll = useCallback(async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 80, 40, 80] : 100);
      const now = new Date();
      const todayStr = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');

      for (const d of doses) {
        if (d.status === 'pending') {
          await nativeAlarmService.stopAlarm(d.scheduleId, d.doseTime);
          if (d.scheduleId) {
            await nativeAlarmService.cancelSnoozesForSchedule(d.scheduleId);
          }
          if (d.scheduleId && d.medicineId) {
            const targetTime =
              d.doseTime ||
              `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            try {
              adherenceRepository.logDoseStatus(
                d.scheduleId,
                d.medicineId,
                todayStr,
                targetTime,
                'taken',
              );
            } catch (logErr) {
              console.warn('Could not record dose adherence log for', d.scheduleId, logErr);
            }
          }
        }
      }

      setDoses((prev) => prev.map((d) => ({ ...d, status: 'taken' as const })));
      setCompletedAction('taken');
      await nativeAlarmService.stopAlarm();
      setTimeout(() => {
        router.replace('/(tabs)/home');
      }, 750);
    } catch (e) {
      console.warn('Failed to take all doses:', e);
      setErrorMessage('Could not take all doses. Please try again.');
      setIsProcessing(false);
    }
  }, [isProcessing, doses, router]);

  // Tactile PanResponder for the single physical slider
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isProcessing,
        onMoveShouldSetPanResponder: (_, gesture) => !isProcessing && Math.abs(gesture.dx) > 6,
        onPanResponderMove: (_, gestureState) => {
          if (isProcessing) return;

          let dx = gestureState.dx;
          if (Math.abs(dx) > MAX_DRAG) {
            const overflow = Math.abs(dx) - MAX_DRAG;
            dx = (dx > 0 ? 1 : -1) * (MAX_DRAG + overflow * 0.22);
          }

          panX.setValue(dx);

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

        {/* Simultaneous Doses Tabs (if multiple doses scheduled at the same time) */}
        {doses.length > 1 && (
          <View style={styles.simultaneousSection}>
            <View style={styles.simultaneousHeader}>
              <Ionicons name="layers-outline" size={14} color={Colors.primary} />
              <Text style={styles.simultaneousHeaderText}>
                {doses.length} Simultaneous Doses ({pendingDoses.length} pending)
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dosePillRow}
            >
              {doses.map((d, idx) => (
                <TouchableOpacity
                  key={d.id}
                  testID={`dose-pill-${d.scheduleId}`}
                  onPress={() => setSelectedIndex(idx)}
                  style={[
                    styles.dosePill,
                    {
                      backgroundColor:
                        idx === selectedIndex ? Colors.primaryLight : themeColors.cardBg,
                      borderColor:
                        idx === selectedIndex ? Colors.primary : themeColors.cardBorder,
                    },
                    d.status === 'taken' && styles.dosePillTaken,
                    d.status === 'snoozed' && styles.dosePillSnoozed,
                  ]}
                >
                  {d.status === 'taken' ? (
                    <Ionicons name="checkmark-circle" size={14} color="#059669" />
                  ) : d.status === 'snoozed' ? (
                    <Ionicons name="alarm" size={14} color="#D97706" />
                  ) : (
                    <Ionicons
                      name="medkit"
                      size={14}
                      color={idx === selectedIndex ? Colors.primary : themeColors.textSecondary}
                    />
                  )}
                  <Text
                    style={[
                      styles.dosePillText,
                      {
                        color:
                          idx === selectedIndex ? Colors.primaryDark : themeColors.textPrimary,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {d.medicineName}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

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
              {currentDose?.doseLabel
                ? `${currentDose.doseLabel} · ${currentDose.doseTime}`
                : currentDose?.doseTime
                  ? `Scheduled at ${currentDose.doseTime}`
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
            {currentDose?.medicineName}
          </Text>
          <Text style={[styles.medAmount, { color: themeColors.textSecondary }]}>
            {currentDose?.dosageForm
              ? `${currentDose.dosageForm.toUpperCase()} · ${currentDose.amount}`
              : currentDose?.amount}
          </Text>

          {/* Per-dose status indicator */}
          {currentDose?.status === 'taken' && (
            <View style={styles.inlineTakenStatus}>
              <Ionicons name="checkmark-circle" size={16} color="#059669" />
              <Text style={styles.inlineTakenStatusText}>This dose has been taken</Text>
            </View>
          )}
          {currentDose?.status === 'snoozed' && (
            <View style={styles.inlineSnoozedStatus}>
              <Ionicons name="alarm" size={16} color="#D97706" />
              <Text style={styles.inlineSnoozedStatusText}>
                This dose is snoozed for {snoozeMinutes}m
              </Text>
            </View>
          )}
        </View>

        {/* Transient Status Feedback Toast */}
        {toastMessage && (
          <View style={styles.transientToast}>
            <Ionicons name="information-circle" size={18} color="#FFFFFF" />
            <Text style={styles.transientToastText}>{toastMessage}</Text>
          </View>
        )}

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
                ? 'All Doses Recorded as Taken'
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

          {/* Secondary Action: Take All Doses (when multiple doses are pending) */}
          {pendingDoses.length > 1 && (
            <TouchableOpacity
              testID="take-all-button"
              style={styles.takeAllButton}
              onPress={executeTakeAll}
              disabled={isProcessing}
            >
              <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
              <Text style={styles.takeAllButtonText}>
                Take All Due Doses ({pendingDoses.length})
              </Text>
            </TouchableOpacity>
          )}
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
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.lg,
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
    paddingVertical: 4,
    borderRadius: Radius.pill,
    marginBottom: 6,
  },
  brandBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primaryDark,
    letterSpacing: 0.2,
  },
  clockText: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  dateText: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  simultaneousSection: {
    width: '100%',
    marginVertical: 4,
  },
  simultaneousHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    justifyContent: 'center',
  },
  simultaneousHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primaryDark,
  },
  dosePillRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 4,
  },
  dosePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
  },
  dosePillSelected: {
    borderColor: Colors.primary,
  },
  dosePillTaken: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  dosePillSnoozed: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
  },
  dosePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  heroCard: {
    width: '100%',
    borderRadius: Radius.card,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    marginVertical: Spacing.xs,
  },
  scheduleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    marginBottom: 12,
  },
  scheduleChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  chimeArea: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 80,
    height: 80,
    marginVertical: 4,
  },
  chimeHalo: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryLight,
  },
  chimeCircle: {
    width: 66,
    height: 66,
    borderRadius: 33,
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
    marginTop: 12,
    marginBottom: 4,
    lineHeight: 30,
  },
  medAmount: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  inlineTakenStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: '#ECFDF5',
  },
  inlineTakenStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  inlineSnoozedStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: '#FFFBEB',
  },
  inlineSnoozedStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#D97706',
  },
  transientToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#374151',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    marginVertical: 4,
  },
  transientToastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  actionToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    marginVertical: 4,
  },
  actionToastTaken: {
    backgroundColor: '#059669',
  },
  actionToastSnooze: {
    backgroundColor: '#D97706',
  },
  actionToastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  errorToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    marginVertical: 4,
  },
  errorToastText: {
    color: Colors.error,
    fontSize: 13,
    fontWeight: '600',
  },
  sliderContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
  },
  sliderTrack: {
    width: SLIDER_WIDTH,
    height: 70,
    borderRadius: 35,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  sliderFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
  },
  sliderFillGreen: {
    backgroundColor: 'rgba(5, 150, 105, 0.22)',
  },
  sliderFillAmber: {
    backgroundColor: 'rgba(217, 119, 6, 0.22)',
  },
  sliderLabelsLayer: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  sliderLabelGroupLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sliderLabelLeftText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D97706',
  },
  sliderLabelGroupRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sliderLabelRightText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#059669',
  },
  sliderPuck: {
    width: PUCK_SIZE,
    height: PUCK_SIZE,
    borderRadius: PUCK_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 6,
  },
  sliderHint: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 8,
    textAlign: 'center',
  },
  takeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    marginTop: 10,
  },
  takeAllButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
