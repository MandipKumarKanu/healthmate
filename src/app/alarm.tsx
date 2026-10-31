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
  BackHandler,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { nativeAlarmService } from '../services/nativeAlarmService';
import { adherenceRepository } from '../database/repositories/adherenceRepository';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { useAppStore } from '../store/appStore';
import { Colors } from '../theme/colors';
import { Radius, Shadows, Spacing } from '../theme/tokens';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SLIDER_WIDTH = Math.min(SCREEN_WIDTH - 40, 360);
const PUCK_SIZE = 54;
const MAX_DRAG = (SLIDER_WIDTH - PUCK_SIZE) / 2 - 5;
const SWIPE_THRESHOLD = MAX_DRAG * 0.65;

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
  const [pulseGlow] = useState(() => new Animated.Value(0.4));

  // Clock ticker & scoped lockscreen window overlap
  useEffect(() => {
    void nativeAlarmService.setLockScreenOverlap(true);

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Prevent exiting the alarm or backing into the app via back button on lock screen
      return true;
    });

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
          month: 'long',
          day: 'numeric',
        }),
      );
    };

    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => {
      clearInterval(timer);
      backHandler.remove();
      void nativeAlarmService.setLockScreenOverlap(false);
    };
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

  // Subtle breathing pulse on the medication hero icon
  useEffect(() => {
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(chimeScale, {
            toValue: 1.06,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseGlow, {
            toValue: 0.8,
            duration: 1500,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(chimeScale, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseGlow, {
            toValue: 0.35,
            duration: 1500,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    pulseAnim.start();

    return () => {
      pulseAnim.stop();
    };
  }, [chimeScale, pulseGlow]);

  // Action: Take Dose
  const executeTakeDose = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

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
        await nativeAlarmService.setLockScreenOverlap(false);
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

  // Action: Snooze Alarm
  const executeSnooze = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

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
        await nativeAlarmService.setLockScreenOverlap(false);
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
      await nativeAlarmService.setLockScreenOverlap(false);
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
    bg: isDark ? '#0D1017' : Colors.background,
    cardBg: isDark ? '#171B26' : Colors.cardBackground,
    cardBorder: isDark ? '#262C3D' : Colors.border,
    textPrimary: isDark ? '#F5F7FA' : Colors.textPrimary,
    textSecondary: isDark ? '#9CA3AF' : Colors.textSecondary,
    trackBg: isDark ? '#1F2433' : '#E8E8EE',
    trackBorder: isDark ? '#2E354B' : '#DCDBE2',
    puckBg: isDark ? '#2A3144' : '#FFFFFF',
    puckBorder: isDark ? '#3D4763' : '#D0CFD7',
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safeArea}>
        {/* Top Brand Header */}
        <View style={styles.header}>
          <View style={styles.brandBadge}>
            <Ionicons name="medkit" size={13} color={Colors.primary} />
            <Text style={styles.brandBadgeText}>HEALTHMATE REMINDER</Text>
          </View>
          <Text style={[styles.clockText, { color: themeColors.textPrimary }]}>{currentTime}</Text>
          <Text style={[styles.dateText, { color: themeColors.textSecondary }]}>
            {currentDate}
            {currentDose?.doseTime ? ` · ${currentDose.doseTime}` : ''}
          </Text>
        </View>

        {/* Simultaneous Doses Selector (when multiple doses are due) */}
        {doses.length > 1 && (
          <View style={styles.simultaneousSection}>
            <View style={styles.simultaneousHeader}>
              <MaterialCommunityIcons name="layers-outline" size={15} color={Colors.primary} />
              <Text style={styles.simultaneousHeaderText}>
                {doses.length} Medications Scheduled ({pendingDoses.length} pending)
              </Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dosePillRow}
            >
              {doses.map((d, idx) => {
                const isSelected = idx === selectedIndex;
                const isTaken = d.status === 'taken';
                const isSnoozed = d.status === 'snoozed';

                return (
                  <TouchableOpacity
                    key={d.id}
                    testID={`dose-pill-${d.scheduleId}`}
                    onPress={() => setSelectedIndex(idx)}
                    activeOpacity={0.7}
                    style={[
                      styles.dosePill,
                      {
                        backgroundColor: isSelected
                          ? Colors.primaryLight
                          : isDark
                            ? '#1D2230'
                            : '#FFFFFF',
                        borderColor: isSelected
                          ? Colors.primary
                          : isDark
                            ? '#2A3247'
                            : Colors.border,
                      },
                      isTaken && styles.dosePillTaken,
                      isSnoozed && styles.dosePillSnoozed,
                    ]}
                  >
                    {isTaken ? (
                      <Ionicons name="checkmark-circle" size={15} color={Colors.success} />
                    ) : isSnoozed ? (
                      <Ionicons name="alarm" size={15} color={Colors.warning} />
                    ) : (
                      <MaterialCommunityIcons
                        name="pill"
                        size={15}
                        color={isSelected ? Colors.primary : themeColors.textSecondary}
                        style={{ transform: [{ rotate: '-45deg' }] }}
                      />
                    )}
                    <Text
                      style={[
                        styles.dosePillText,
                        {
                          color: isSelected
                            ? Colors.primaryDark
                            : isTaken
                              ? Colors.successDark
                              : isSnoozed
                                ? Colors.warningDark
                                : themeColors.textPrimary,
                          fontWeight: isSelected ? '700' : '600',
                        },
                      ]}
                      numberOfLines={1}
                    >
                      {d.medicineName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Main Medication Hero Card */}
        <View
          style={[
            styles.heroCard,
            {
              backgroundColor: themeColors.cardBg,
              borderColor: themeColors.cardBorder,
            },
          ]}
        >
          {/* Schedule Time & Routine Chip */}
          <View style={styles.scheduleChip}>
            <Ionicons name="time" size={13} color={Colors.primary} />
            <Text style={styles.scheduleChipText}>
              {currentDose?.doseLabel
                ? `${currentDose.doseLabel} · Scheduled for ${currentDose.doseTime || 'now'}`
                : currentDose?.doseTime
                  ? `Scheduled for ${currentDose.doseTime}`
                  : 'Time to take your dose'}
            </Text>
          </View>

          {/* Elegant Medication Pill Icon with Ambient Breathing Ring */}
          <View style={styles.iconWrapper}>
            <Animated.View
              style={[
                styles.iconPulseRing,
                {
                  transform: [{ scale: chimeScale }],
                  opacity: pulseGlow,
                },
              ]}
            />
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons
                name="pill"
                size={38}
                color={Colors.primary}
                style={{ transform: [{ rotate: '-45deg' }] }}
              />
            </View>
          </View>

          {/* Medication Name */}
          <Text style={[styles.medName, { color: themeColors.textPrimary }]} numberOfLines={2}>
            {currentDose?.medicineName}
          </Text>

          {/* Dosage & Metadata Pills */}
          <View style={styles.badgeRow}>
            <View style={styles.metaBadge}>
              <MaterialCommunityIcons name="medical-bag" size={13} color={Colors.primary} />
              <Text style={styles.metaBadgeText}>{currentDose?.amount}</Text>
            </View>

            {Boolean(currentDose?.dosageForm) && (
              <View style={styles.metaBadge}>
                <Ionicons name="fitness-outline" size={13} color={Colors.primary} />
                <Text style={styles.metaBadgeText}>
                  {currentDose?.dosageForm?.toUpperCase()}
                </Text>
              </View>
            )}
          </View>

          {/* Per-dose status banner */}
          {currentDose?.status === 'taken' && (
            <View style={styles.inlineTakenStatus}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
              <Text style={styles.inlineTakenStatusText}>This dose has been marked as taken</Text>
            </View>
          )}
          {currentDose?.status === 'snoozed' && (
            <View style={styles.inlineSnoozedStatus}>
              <Ionicons name="alarm" size={16} color={Colors.warning} />
              <Text style={styles.inlineSnoozedStatusText}>
                Snoozed · Next reminder in {snoozeMinutes} minutes
              </Text>
            </View>
          )}
        </View>

        {/* Transient Feedback Banner */}
        {toastMessage && (
          <View style={styles.transientToast}>
            <Ionicons name="information-circle" size={18} color="#FFFFFF" />
            <Text style={styles.transientToastText}>{toastMessage}</Text>
          </View>
        )}

        {/* Completed Action Feedback */}
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

        {/* Error Feedback */}
        {errorMessage && (
          <View style={styles.errorToast}>
            <Ionicons name="alert-circle" size={18} color={Colors.error} />
            <Text style={styles.errorToastText}>{errorMessage}</Text>
          </View>
        )}

        {/* Interactive Controls Container */}
        <View style={styles.actionContainer}>
          {/* Primary Swipe Interaction Slider */}
          <View
            style={[
              styles.sliderTrack,
              {
                backgroundColor: themeColors.trackBg,
                borderColor: themeColors.trackBorder,
              },
            ]}
          >
            {/* Amber Snooze Glow */}
            <Animated.View
              style={[styles.sliderFill, styles.sliderFillAmber, { opacity: amberFillOpacity }]}
            />
            {/* Green Take Glow */}
            <Animated.View
              style={[styles.sliderFill, styles.sliderFillGreen, { opacity: greenFillOpacity }]}
            />

            {/* Target Label Guides */}
            <View style={styles.sliderLabelsLayer} pointerEvents="none">
              <View style={styles.sliderLabelGroupLeft}>
                <Ionicons name="alarm-outline" size={16} color={Colors.warningDark} />
                <Text style={styles.sliderLabelLeftText}>Snooze {snoozeMinutes}m</Text>
              </View>
              <View style={styles.sliderLabelGroupRight}>
                <Text style={styles.sliderLabelRightText}>Take Dose</Text>
                <Ionicons name="checkmark-circle-outline" size={16} color={Colors.successDark} />
              </View>
            </View>

            {/* Draggable Puck */}
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
              <MaterialCommunityIcons name="swap-horizontal" size={26} color={Colors.primary} />
            </Animated.View>
          </View>

          {/* Quick Tap Buttons: Effortless 1-tap alternatives */}
          <View style={styles.quickTapRow}>
            <TouchableOpacity
              style={styles.snoozeButton}
              onPress={executeSnooze}
              disabled={isProcessing}
              activeOpacity={0.8}
            >
              <Ionicons name="alarm-outline" size={17} color={Colors.warningDark} />
              <Text style={styles.snoozeButtonText}>Snooze {snoozeMinutes}m</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.takeButton}
              onPress={executeTakeDose}
              disabled={isProcessing}
              activeOpacity={0.8}
            >
              <Ionicons name="checkmark-circle" size={17} color="#FFFFFF" />
              <Text style={styles.takeButtonText}>Take Dose</Text>
            </TouchableOpacity>
          </View>

          {/* Secondary Action: Take All Doses when multiple are due */}
          {pendingDoses.length > 1 && (
            <TouchableOpacity
              testID="take-all-button"
              style={styles.takeAllButton}
              onPress={executeTakeAll}
              disabled={isProcessing}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
              <Text style={styles.takeAllButtonText}>
                Take All Due Medications ({pendingDoses.length})
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
    paddingBottom: Spacing.md,
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
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primaryDark,
    letterSpacing: 0.8,
  },
  clockText: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: -0.5,
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
    paddingVertical: 2,
  },
  dosePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    ...Shadows.subtle,
  },
  dosePillTaken: {
    backgroundColor: Colors.successLight,
    borderColor: Colors.success,
  },
  dosePillSnoozed: {
    backgroundColor: Colors.warningLight,
    borderColor: Colors.warning,
  },
  dosePillText: {
    fontSize: 13,
  },
  heroCard: {
    width: '100%',
    borderRadius: 24,
    paddingVertical: 22,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    ...Shadows.card,
    elevation: 4,
    marginVertical: Spacing.xs,
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
    fontSize: 12,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  iconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 84,
    height: 84,
    marginVertical: 4,
  },
  iconPulseRing: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: Colors.primaryLight,
  },
  iconContainer: {
    width: 66,
    height: 66,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(7, 136, 245, 0.2)',
  },
  medName: {
    fontSize: 25,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 14,
    marginBottom: 8,
    lineHeight: 32,
    paddingHorizontal: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  metaBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  inlineTakenStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.successLight,
  },
  inlineTakenStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.successDark,
  },
  inlineSnoozedStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.warningLight,
  },
  inlineSnoozedStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.warningDark,
  },
  transientToast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    marginVertical: 4,
    ...Shadows.subtle,
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
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: Radius.pill,
    marginVertical: 4,
    ...Shadows.subtle,
  },
  actionToastTaken: {
    backgroundColor: Colors.success,
  },
  actionToastSnooze: {
    backgroundColor: Colors.warning,
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
    backgroundColor: Colors.errorLight,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    marginVertical: 4,
  },
  errorToastText: {
    color: Colors.errorDark,
    fontSize: 13,
    fontWeight: '600',
  },
  actionContainer: {
    width: '100%',
    alignItems: 'center',
    gap: 10,
    marginTop: 2,
  },
  sliderTrack: {
    width: SLIDER_WIDTH,
    height: 64,
    borderRadius: 32,
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
    backgroundColor: 'rgba(50, 195, 106, 0.22)',
  },
  sliderFillAmber: {
    backgroundColor: 'rgba(233, 168, 74, 0.22)',
  },
  sliderLabelsLayer: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
  },
  sliderLabelGroupLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sliderLabelLeftText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.warningDark,
  },
  sliderLabelGroupRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sliderLabelRightText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.successDark,
  },
  sliderPuck: {
    width: PUCK_SIZE,
    height: PUCK_SIZE,
    borderRadius: PUCK_SIZE / 2,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.card,
    elevation: 6,
  },
  quickTapRow: {
    flexDirection: 'row',
    width: SLIDER_WIDTH,
    gap: 10,
  },
  snoozeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.warningLight,
    paddingVertical: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.warningBannerBorder,
  },
  snoozeButtonText: {
    color: Colors.warningDark,
    fontSize: 13,
    fontWeight: '700',
  },
  takeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.success,
    paddingVertical: 12,
    borderRadius: Radius.pill,
    ...Shadows.subtle,
    elevation: 2,
  },
  takeButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  takeAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    width: SLIDER_WIDTH,
    paddingVertical: 12,
    borderRadius: Radius.pill,
    ...Shadows.subtle,
    elevation: 3,
  },
  takeAllButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
