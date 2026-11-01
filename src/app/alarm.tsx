import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Animated,
  Vibration,
  Platform,
  TouchableOpacity,
  ScrollView,
  BackHandler,
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { MedicineIcon } from '../components/ui/MedicineIcon';
import { StatusBadge } from '../components/ui/StatusBadge';
import { formatTime12Hour } from '../utils/reminderValidation';
import { nativeAlarmService } from '../services/nativeAlarmService';
import { adherenceRepository } from '../database/repositories/adherenceRepository';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { useAppStore } from '../store/appStore';
import { Colors } from '../theme/colors';
import { Radius, Shadows, Spacing } from '../theme/tokens';

export interface ActiveDoseItem {
  id: string;
  scheduleId: string;
  medicineId: string;
  medicineName: string;
  amount: string;
  doseTime: string;
  doseLabel: string;
  dosageForm?: string;
  recurrence?: string;
  instanceId?: string;
  sourceScheduleId?: string;
  status: 'pending' | 'taken' | 'snoozed' | 'skipped';
}

export type SliderAction = 'take' | 'snooze' | 'skip';

function formatRecurrence(rec?: string): string {
  if (!rec) return 'Daily';
  switch (rec.toLowerCase()) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    case 'once':
      return 'One-time';
    case 'custom':
      return 'Scheduled';
    default:
      return rec.charAt(0).toUpperCase() + rec.slice(1);
  }
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
  let mName = medicineName ?? 'Amoxicillin';
  let amt = amount ?? '500 mg · 1 Capsule';
  let dTime = doseTime ?? '08:00 AM';
  let dLabel = doseLabel ?? 'Morning Dose';
  let mId = '';
  let dForm = 'capsule';
  let rec = 'daily';

  if (sId) {
    const sched = scheduleRepository.getById(sId);
    if (sched) {
      rec = sched.recurrence || 'daily';
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

  const id = `${sId || mId || mName.toLowerCase().trim()}_${dTime || '00:00'}`;

  return {
    id,
    scheduleId: sId,
    medicineId: mId,
    medicineName: mName,
    amount: amt,
    doseTime: dTime,
    doseLabel: dLabel,
    dosageForm: dForm,
    recurrence: rec,
    instanceId,
    sourceScheduleId,
    status: 'pending',
  };
}

function formatDoseTime(timeStr?: string): { time: string; period: string } {
  if (!timeStr) {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return { time: `${String(hours).padStart(2, '0')}:${minutes}`, period };
  }

  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = match[2];
    const rawPeriod = match[3];

    let period = rawPeriod ? rawPeriod.toUpperCase() : hours >= 12 ? 'PM' : 'AM';
    if (!rawPeriod && hours >= 12) {
      hours = hours % 12 || 12;
    } else if (!rawPeriod && hours === 0) {
      hours = 12;
    } else if (rawPeriod && hours > 12) {
      hours = hours % 12 || 12;
    }
    return { time: `${String(hours).padStart(2, '0')}:${minutes}`, period };
  }

  return { time: timeStr, period: '' };
}

export default function FullScreenAlarmScreen() {
  const router = useRouter();

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

  const [completedAction, setCompletedAction] = useState<'taken' | 'snooze' | 'skipped' | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const { width: screenWidth } = useWindowDimensions();
  const SLIDER_WIDTH = Math.min(screenWidth - 40, 360);
  const THUMB_SIZE = 54;
  const maxSlide = SLIDER_WIDTH - THUMB_SIZE - 8;

  const [sliderAction, setSliderAction] = useState<SliderAction>('take');
  const [slideX] = useState(() => new Animated.Value(0));
  const [sliderCompleted, setSliderCompleted] = useState(false);

  // Animation values
  const [chimeScale] = useState(() => new Animated.Value(1));
  const [bellRotate] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const ringAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(bellRotate, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue: -1, duration: 300, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(bellRotate, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.delay(1800),
      ]),
    );

    ringAnim.start();

    return () => {
      ringAnim.stop();
    };
  }, [bellRotate]);

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

  // Scoped lockscreen window overlap & back button trapping
  useEffect(() => {
    void nativeAlarmService.setLockScreenOverlap(true);

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Prevent backing into the app or leaving without action while device is locked
      return true;
    });

    return () => {
      backHandler.remove();
      void nativeAlarmService.setLockScreenOverlap(false);
    };
  }, []);

  // Discover and aggregate simultaneous doses — strictly deduplicating by schedule and medicine
  useEffect(() => {
    let isMounted = true;

    async function loadSimultaneousDoses() {
      const now = new Date();
      const todayStr = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');

      const doseList: ActiveDoseItem[] = [initialDose];

      const isDuplicate = (cand: ActiveDoseItem) => {
        return doseList.some((d) => {
          if (cand.scheduleId && d.scheduleId && cand.scheduleId === d.scheduleId) {
            return true;
          }
          if (
            cand.medicineName.toLowerCase().trim() === d.medicineName.toLowerCase().trim() &&
            cand.doseTime === d.doseTime
          ) {
            return true;
          }
          return false;
        });
      };

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
          if (!isDuplicate(item)) {
            doseList.push(item);
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
              if (!isDuplicate(item)) {
                doseList.push(item);
              }
            }
          }
        } catch (_e) {}
      }

      if (isMounted) {
        setDoses(doseList);
      }
    }

    loadSimultaneousDoses();

    return () => {
      isMounted = false;
    };
  }, [initialDose]);

  const currentDose = doses[selectedIndex] || doses[0];
  const pendingDoses = useMemo(() => doses.filter((d) => d.status === 'pending'), [doses]);

  // Subtle breathing pulse on the primary action button
  useEffect(() => {
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(chimeScale, {
          toValue: 1.05,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(chimeScale, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );

    pulseAnim.start();

    return () => {
      pulseAnim.stop();
    };
  }, [chimeScale]);

  // Action: Take Dose
  const executeTakeDose = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

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
      setSliderCompleted(false);
      Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
      setIsProcessing(false);
    }
  }, [isProcessing, currentDose, doses, router, slideX]);

  // Action: Snooze Alarm
  const executeSnooze = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 40, 40, 80] : 100);
      if (currentDose.scheduleId) {
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
      } else {
        await nativeAlarmService.stopAlarm();
      }

      const updated = doses.map((d) =>
        d.id === currentDose.id ? { ...d, status: 'snoozed' as const } : d,
      );
      setDoses(updated);

      const remainingPending = updated.filter((d) => d.status === 'pending');
      if (remainingPending.length > 0) {
        const nextIdx = updated.findIndex((d) => d.status === 'pending');
        setSelectedIndex(nextIdx);
        setToastMessage(`${currentDose.medicineName} snoozed for ${snoozeMinutes}m`);
        setSliderAction('take');
        setSliderCompleted(false);
        slideX.setValue(0);
        setTimeout(() => setToastMessage(null), 2500);
        setIsProcessing(false);
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
      setSliderCompleted(false);
      Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
      setIsProcessing(false);
    }
  }, [isProcessing, currentDose, doses, snoozeMinutes, router, slideX]);

  // Action: Skip Dose
  const executeSkipDose = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 35, 35, 35] : 70);
      if (currentDose.scheduleId) {
        await nativeAlarmService.stopAlarm(currentDose.scheduleId, currentDose.doseTime);
        await nativeAlarmService.cancelSnoozesForSchedule(currentDose.scheduleId);
      } else {
        await nativeAlarmService.stopAlarm();
      }

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
        adherenceRepository.logDoseStatus(
          currentDose.scheduleId,
          currentDose.medicineId,
          todayStr,
          targetTime,
          'skipped',
        );
      }

      const updated = doses.map((d) =>
        d.id === currentDose.id ? { ...d, status: 'skipped' as const } : d,
      );
      setDoses(updated);

      const remainingPending = updated.filter((d) => d.status === 'pending');
      if (remainingPending.length > 0) {
        setSelectedIndex(updated.findIndex((d) => d.status === 'pending'));
        setToastMessage(`${currentDose.medicineName} skipped for now`);
        setSliderAction('take');
        setSliderCompleted(false);
        slideX.setValue(0);
        setTimeout(() => setToastMessage(null), 2500);
        setIsProcessing(false);
      } else {
        setCompletedAction('skipped');
        await nativeAlarmService.setLockScreenOverlap(false);
        await nativeAlarmService.stopAlarm();
        setTimeout(() => router.replace('/(tabs)/home'), 750);
      }
    } catch (error) {
      console.warn('Failed to skip dose:', error);
      setErrorMessage('Could not skip this dose. Please try again.');
      setSliderCompleted(false);
      Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
      setIsProcessing(false);
    }
  }, [isProcessing, currentDose, doses, router, slideX]);

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
      setSliderCompleted(false);
      Animated.spring(slideX, { toValue: 0, useNativeDriver: false }).start();
      setIsProcessing(false);
    }
  }, [isProcessing, doses, router, slideX]);

  const currentSchedule = useMemo(
    () => (currentDose?.scheduleId ? scheduleRepository.getById(currentDose.scheduleId) : null),
    [currentDose],
  );

  // Look for next scheduled medicine today
  const nextDose = useMemo(() => {
    // 1. Any other simultaneous pending dose
    const pendingOther = pendingDoses.find((d) => d.id !== currentDose?.id);
    if (pendingOther) return pendingOther;

    // 2. Or the next upcoming dose in repository
    try {
      const now = new Date();
      const todayStr = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');
      const todayDoses = adherenceRepository.getDosesForDate(todayStr);
      const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const upcoming = todayDoses.find(
        (td) => td.time > currentTimeStr && td.status !== 'taken' && td.status !== 'skipped',
      );
      if (upcoming) {
        return resolveDoseItem(
          upcoming.scheduleId,
          undefined,
          upcoming.medicineName,
          upcoming.amount,
          upcoming.time,
        );
      }
    } catch (_e) {}
    return null;
  }, [pendingDoses, currentDose]);

  const doseInstruction = currentDose?.amount?.includes('·')
    ? currentDose.amount.split('·').slice(1).join('·').trim()
    : currentDose?.amount || '1 tablet';

  const recurrenceLabel =
    currentSchedule?.recurrence === 'daily'
      ? 'Every day'
      : currentSchedule?.recurrence === 'weekly'
        ? 'Every week'
        : currentSchedule?.recurrence === 'monthly'
          ? 'Every month'
          : currentSchedule?.recurrence === 'once'
            ? 'One-time reminder'
            : 'Every day';

  const startedLabel = currentSchedule?.startDate
    ? new Date(`${currentSchedule.startDate}T00:00:00`).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Started Apr 22, 2026';

  const clockDisplayTime = useMemo(() => {
    const raw = currentDose?.doseTime || '08:00';
    const match = raw.match(/(\d{1,2}:\d{2})/);
    return match ? match[1] : '08:00';
  }, [currentDose?.doseTime]);

  const formattedCurrentTime = useMemo(
    () => formatTime12Hour(currentDose?.doseTime || '08:00'),
    [currentDose?.doseTime],
  );

  const displayNextDose = useMemo(() => {
    if (nextDose) {
      const match = nextDose.doseTime?.match(/(\d{1,2}:\d{2})/);
      return {
        medicineName: nextDose.medicineName,
        doseTime: match ? match[1] : nextDose.doseTime || '08:00',
        amount: nextDose.amount || '1 dose',
      };
    }
    return {
      medicineName: 'Vitamin D3',
      doseTime: '08:00',
      amount: '1 softgel',
    };
  }, [nextDose]);

  const handleDismiss = useCallback(async () => {
    try {
      await nativeAlarmService.stopAlarm(currentDose?.scheduleId, currentDose?.doseTime);
    } catch (_e) {}
    Vibration.cancel();
    router.replace('/(tabs)/home');
  }, [currentDose, router]);

  const selectSliderAction = useCallback(
    (action: SliderAction) => {
      setSliderAction(action);
      setSliderCompleted(false);
      slideX.setValue(0);
    },
    [slideX, setSliderAction, setSliderCompleted],
  );

  // Arrow shimmer pulse animation
  const [arrowPulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowPulse, { toValue: 6, duration: 900, useNativeDriver: true }),
        Animated.timing(arrowPulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [arrowPulse]);

  // Reset slider if dose changes
  useEffect(() => {
    setSliderCompleted(false);
    setSliderAction('take');
    slideX.setValue(0);
  }, [currentDose?.id, slideX, setSliderCompleted, setSliderAction]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isProcessing && !sliderCompleted,
        onMoveShouldSetPanResponder: () => !isProcessing && !sliderCompleted,
        onPanResponderMove: (_, gestureState) => {
          if (gestureState.dx > 0) {
            slideX.setValue(Math.min(gestureState.dx, maxSlide));
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dx >= maxSlide * 0.7) {
            setSliderCompleted(true);
            Vibration.vibrate(Platform.OS === 'android' ? [0, 80] : 80);
            Animated.timing(slideX, {
              toValue: maxSlide,
              duration: 140,
              useNativeDriver: false,
            }).start(() => {
              if (sliderAction === 'snooze') {
                executeSnooze();
              } else if (sliderAction === 'skip') {
                executeSkipDose();
              } else {
                if (pendingDoses.length > 1) {
                  executeTakeAll();
                } else {
                  executeTakeDose();
                }
              }
            });
          } else {
            Animated.spring(slideX, {
              toValue: 0,
              tension: 40,
              friction: 7,
              useNativeDriver: false,
            }).start();
          }
        },
      }),
    [
      isProcessing,
      sliderCompleted,
      setSliderCompleted,
      maxSlide,
      sliderAction,
      pendingDoses.length,
      executeTakeAll,
      executeTakeDose,
      executeSnooze,
      executeSkipDose,
      slideX,
    ],
  );

  const textOpacity = slideX.interpolate({
    inputRange: [0, maxSlide * 0.5],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  const trackFillWidth = slideX.interpolate({
    inputRange: [0, maxSlide],
    outputRange: [THUMB_SIZE + 8, SLIDER_WIDTH],
    extrapolate: 'clamp',
  });

  const sliderGuideText = useMemo(() => {
    if (sliderAction === 'snooze') return `slide to snooze ${snoozeMinutes}m`;
    if (sliderAction === 'skip') return 'slide to skip this dose';
    return pendingDoses.length > 1
      ? `slide to take all ${pendingDoses.length}`
      : 'slide to mark as taken';
  }, [sliderAction, snoozeMinutes, pendingDoses.length]);

  const sliderThumbColor = useMemo(() => {
    if (sliderAction === 'snooze') return '#D97706';
    if (sliderAction === 'skip') return '#E11D48';
    return '#0788F5';
  }, [sliderAction]);

  const sliderFillColor = useMemo(() => {
    if (sliderAction === 'snooze') return '#FEF3C7';
    if (sliderAction === 'skip') return '#FEE2E2';
    return '#E0F2FE';
  }, [sliderAction]);

  // Today's formatted date for lockscreen
  const lockscreenDate = useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screenContainer}>
          {/* Feedback & Error Banners */}
          {toastMessage && (
            <View style={styles.toastBanner}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.toastText}>{toastMessage}</Text>
            </View>
          )}

          {completedAction && (
            <View style={styles.completedBanner}>
              <Ionicons
                name={
                  completedAction === 'taken'
                    ? 'checkmark-circle'
                    : completedAction === 'snooze'
                      ? 'alarm'
                      : 'close-circle'
                }
                size={16}
                color={completedAction === 'taken' ? Colors.success : Colors.warning}
              />
              <Text style={styles.completedText}>
                {completedAction === 'taken'
                  ? 'All doses recorded as taken'
                  : completedAction === 'snooze'
                    ? `Snoozed for ${snoozeMinutes} minutes`
                    : 'Dose skipped for now'}
              </Text>
            </View>
          )}

          {errorMessage && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle-outline" size={16} color={Colors.error} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* Ambient Radial Rings behind clock */}
          <View style={styles.ambientRingsContainer} pointerEvents="none">
            <View style={styles.ambientRingOuter} />
            <View style={styles.ambientRingInner} />
          </View>

          {/* Monumental Lockscreen Clock with radiating rays */}
          <View style={styles.lockClockSection}>
            <View style={styles.topClockBadge}>
              <Ionicons name="time" size={26} color="#0788F5" />
            </View>
            <Text style={styles.clockSubHeader}>Medicine Reminder</Text>
            <View style={styles.clockRow}>
              <View style={styles.clockRaysLeft}>
                <View style={[styles.ray, styles.rayTopLeft]} />
                <View style={[styles.ray, styles.rayMidLeft]} />
                <View style={[styles.ray, styles.rayBotLeft]} />
              </View>
              <Text style={styles.clockTime}>{clockDisplayTime}</Text>
              <View style={styles.clockRaysRight}>
                <View style={[styles.ray, styles.rayTopRight]} />
                <View style={[styles.ray, styles.rayMidRight]} />
                <View style={[styles.ray, styles.rayBotRight]} />
              </View>
            </View>
            <Text style={styles.clockSubtitle}>Time to take your medicine</Text>
          </View>

          {/* Hero Medicine Display: Adaptive for 1 Medicine vs 2+ Medicines */}
          {doses.length === 1 ? (
            /* Single Medicine Hero Card */
            <View style={styles.heroCard}>
              <View style={styles.heroCardHeader}>
                <View style={styles.heroIconBox}>
                  <MaterialCommunityIcons
                    name="pill"
                    size={28}
                    color="#0788F5"
                    style={{ transform: [{ rotate: '-45deg' }] }}
                  />
                </View>
                <View style={styles.heroTitleCol}>
                  <Text style={styles.heroMedName} numberOfLines={1}>
                    {currentDose?.medicineName || 'Metformin'}
                  </Text>
                  <Text style={styles.heroDoseAmount}>
                    {currentDose?.amount || '500 mg · 1 tablet'}
                  </Text>
                </View>
                <View style={styles.heroDoseTag}>
                  <Text style={styles.heroDoseTagText}>
                    {currentDose?.doseLabel || 'Morning Dose'}
                  </Text>
                </View>
              </View>

              <View style={styles.cardDetailBox}>
                <View style={styles.detailRow}>
                  <View style={styles.detailIconBox}>
                    <Ionicons name="calendar-outline" size={17} color="#64748B" />
                  </View>
                  <View style={styles.detailTextCol}>
                    <Text style={styles.detailTitle}>{recurrenceLabel}</Text>
                    <Text style={styles.detailSubtitle}>{startedLabel}</Text>
                  </View>
                </View>

                <View style={styles.detailDivider} />

                <View style={styles.detailRow}>
                  <View style={styles.detailIconBox}>
                    <Ionicons name="document-text-outline" size={17} color="#64748B" />
                  </View>
                  <View style={styles.detailTextCol}>
                    <Text style={styles.detailTitle}>
                      Take {currentDose?.amount?.split('·')[1]?.trim() || currentDose?.amount || '1 tablet'}
                    </Text>
                    <Text style={styles.detailSubtitle}>As directed on your label</Text>
                  </View>
                </View>

                <View style={styles.detailDivider} />

                <View style={styles.detailRow}>
                  <View style={styles.detailIconBox}>
                    <Ionicons name="information-circle-outline" size={17} color="#64748B" />
                  </View>
                  <View style={styles.detailTextCol}>
                    <Text style={styles.detailTitle}>From your saved schedule</Text>
                    <Text style={styles.detailSubtitle}>Follow your doctor's instructions</Text>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            /* Multi-Medicine Grouped Card (When 2 or more medicines are due at same time) */
            <View style={styles.multiMedCard}>
              <View style={styles.multiMedHeader}>
                <View style={styles.multiMedHeaderLeft}>
                  <View style={styles.multiIconBadge}>
                    <MaterialCommunityIcons
                      name="pill-multiple"
                      size={20}
                      color="#0788F5"
                    />
                  </View>
                  <View>
                    <Text style={styles.multiHeaderTitle}>Scheduled Medications</Text>
                    <Text style={styles.multiHeaderSubtitle}>
                      Take with water as directed
                    </Text>
                  </View>
                </View>
                <View style={styles.multiCountBadge}>
                  <Text style={styles.multiCountBadgeText}>
                    {pendingDoses.length} Due
                  </Text>
                </View>
              </View>

              <ScrollView
                style={styles.multiScrollList}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                {doses.map((dose, idx) => {
                  const isTaken = dose.status === 'taken';
                  const isSkipped = dose.status === 'skipped';
                  const isLast = idx === doses.length - 1;

                  return (
                    <View key={dose.id}>
                      <TouchableOpacity
                        style={styles.multiDoseRow}
                        onPress={() => setSelectedIndex(idx)}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.multiRowIconBox,
                            isTaken && styles.multiRowIconBoxTaken,
                          ]}
                        >
                          <MaterialCommunityIcons
                            name="pill"
                            size={20}
                            color={isTaken ? Colors.success : '#0788F5'}
                            style={{ transform: [{ rotate: '-45deg' }] }}
                          />
                        </View>

                        <View style={styles.multiRowTextCol}>
                          <Text
                            style={[
                              styles.multiRowMedName,
                              (isTaken || isSkipped) && styles.multiRowMedNameMuted,
                            ]}
                            numberOfLines={1}
                          >
                            {dose.medicineName}
                          </Text>
                          <Text style={styles.multiRowDoseAmount} numberOfLines={1}>
                            {dose.amount} · {formatRecurrence(dose.recurrence)}
                          </Text>
                        </View>

                        <View style={styles.multiRowStatusCol}>
                          {isTaken ? (
                            <View style={styles.rowTakenBadge}>
                              <Ionicons name="checkmark" size={13} color={Colors.success} />
                              <Text style={styles.rowTakenBadgeText}>Taken</Text>
                            </View>
                          ) : isSkipped ? (
                            <View style={styles.rowSkippedBadge}>
                              <Text style={styles.rowSkippedBadgeText}>Skipped</Text>
                            </View>
                          ) : (
                            <View style={styles.rowDueBadge}>
                              <Text style={styles.rowDueBadgeText}>Due</Text>
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>

                      {!isLast && <View style={styles.multiRowSeparator} />}
                    </View>
                  );
                })}
              </ScrollView>

              <View style={styles.multiCardFooter}>
                <Ionicons name="time-outline" size={13} color="#8A8991" />
                <Text style={styles.multiCardFooterText}>
                  Scheduled for {formattedCurrentTime} routine
                </Text>
              </View>
            </View>
          )}

          {/* Bottom Interactive Lockscreen Slider & Actions */}
          <View style={styles.bottomSection}>
            {/* Interactive Slider Track */}
            <View style={[styles.sliderTrack, { width: SLIDER_WIDTH }]}>
              {/* Fill Track */}
              <Animated.View
                style={[
                  styles.sliderFill,
                  {
                    width: trackFillWidth,
                    backgroundColor: sliderFillColor,
                  },
                ]}
              />

              {/* Centered Guide Text */}
              <Animated.View style={[styles.sliderTextContainer, { opacity: textOpacity }]}>
                <Text
                  style={[
                    styles.sliderGuideText,
                    sliderAction === 'snooze' && { color: '#B45309' },
                    sliderAction === 'skip' && { color: '#BE123C' },
                  ]}
                >
                  {sliderGuideText}
                </Text>
                <Animated.View style={{ transform: [{ translateX: arrowPulse }] }}>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={
                      sliderAction === 'snooze'
                        ? '#B45309'
                        : sliderAction === 'skip'
                          ? '#BE123C'
                          : '#94A3B8'
                    }
                  />
                </Animated.View>
              </Animated.View>

              {/* Draggable Thumb */}
              <Animated.View
                style={[
                  styles.sliderThumb,
                  {
                    backgroundColor: sliderThumbColor,
                    transform: [{ translateX: slideX }],
                  },
                ]}
                {...panResponder.panHandlers}
              >
                {sliderCompleted ? (
                  <Ionicons name="checkmark" size={24} color="#FFFFFF" />
                ) : sliderAction === 'snooze' ? (
                  <MaterialCommunityIcons name="alarm-snooze" size={22} color="#FFFFFF" />
                ) : sliderAction === 'skip' ? (
                  <Ionicons name="close" size={24} color="#FFFFFF" />
                ) : (
                  <Ionicons name="arrow-forward" size={22} color="#FFFFFF" />
                )}
              </Animated.View>
            </View>

            {/* Secondary Controls: Switch mode to Snooze/Skip or Cancel */}
            <View style={styles.secondaryControlsRow}>
              {sliderAction === 'take' ? (
                <>
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => selectSliderAction('snooze')}
                    disabled={isProcessing}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Switch to snooze ${snoozeMinutes} minutes`}
                  >
                    <MaterialCommunityIcons name="alarm-snooze" size={17} color="#475569" />
                    <Text style={styles.secondaryBtnText}>Snooze {snoozeMinutes}m</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => selectSliderAction('skip')}
                    disabled={isProcessing}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Switch to skip dose"
                  >
                    <Ionicons name="close" size={17} color="#94A3B8" />
                    <Text style={[styles.secondaryBtnText, { color: '#64748B' }]}>
                      Skip for now
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.cancelModeBtn}
                  onPress={() => selectSliderAction('take')}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel and return to take dose"
                >
                  <Ionicons name="arrow-back" size={16} color="#0788F5" />
                  <Text style={styles.cancelModeBtnText}>Back to Take Dose</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Upcoming Dose Card */}
            {displayNextDose && (
              <View style={styles.nextDoseCard}>
                <View style={styles.nextDoseIconBox}>
                  <Ionicons name="document-text-outline" size={15} color="#0788F5" />
                </View>
                <View style={styles.nextDoseTextCol}>
                  <Text style={styles.nextDoseTitle}>Next: {displayNextDose.medicineName}</Text>
                  <Text style={styles.nextDoseSubtitle}>
                    {displayNextDose.doseTime} · {displayNextDose.amount}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  safeArea: {
    flex: 1,
  },
  screenContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 14,
  },

  // ---------------------------------------------------------------------------
  // Ambient Rings & Monumental Clock
  // ---------------------------------------------------------------------------
  ambientRingsContainer: {
    position: 'absolute',
    top: -30,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ambientRingOuter: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(235, 244, 255, 0.4)',
  },
  ambientRingInner: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(235, 244, 255, 0.65)',
  },
  lockClockSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 4,
  },
  topClockBadge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#0788F5',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 2,
  },
  clockSubHeader: {
    fontSize: 14.5,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clockRaysLeft: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginRight: 12,
    height: 60,
  },
  clockRaysRight: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: 12,
    height: 60,
  },
  ray: {
    width: 14,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#0788F5',
    marginVertical: 4,
  },
  rayTopLeft: {
    transform: [{ rotate: '25deg' }],
  },
  rayMidLeft: {
    width: 17,
  },
  rayBotLeft: {
    transform: [{ rotate: '-25deg' }],
  },
  rayTopRight: {
    transform: [{ rotate: '-25deg' }],
  },
  rayMidRight: {
    width: 17,
  },
  rayBotRight: {
    transform: [{ rotate: '25deg' }],
  },
  clockTime: {
    fontSize: 74,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -2,
    lineHeight: 80,
  },
  clockSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 4,
  },

  // ---------------------------------------------------------------------------
  // Hero Medicine Card (Inspiring, rich structured layout)
  // ---------------------------------------------------------------------------
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0788F5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
    marginVertical: 4,
  },
  heroCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  heroIconBox: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  heroTitleCol: {
    flex: 1,
    justifyContent: 'center',
  },
  heroMedName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  heroDoseAmount: {
    fontSize: 14.5,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
  heroDoseTag: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  heroDoseTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0788F5',
  },
  cardDetailBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailIconBox: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  detailTextCol: {
    flex: 1,
  },
  detailTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    letterSpacing: -0.2,
  },
  detailSubtitle: {
    fontSize: 12.5,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  detailDivider: {
    height: 1,
    backgroundColor: '#EEF2F6',
    marginVertical: 8,
  },



  // ---------------------------------------------------------------------------
  // Multi-Medicine Grouped Card
  // ---------------------------------------------------------------------------
  multiMedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
    marginVertical: 6,
    overflow: 'hidden',
  },
  multiMedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  multiMedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  multiIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  multiHeaderSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  multiCountBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  multiCountBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0788F5',
  },
  multiScrollList: {
    maxHeight: 220,
  },
  multiDoseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  multiRowIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  multiRowIconBoxTaken: {
    backgroundColor: '#ECFDF5',
  },
  multiRowTextCol: {
    flex: 1,
    marginLeft: 12,
  },
  multiRowMedName: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  multiRowMedNameMuted: {
    color: '#94A3B8',
    textDecorationLine: 'line-through',
  },
  multiRowDoseAmount: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 2,
  },
  multiRowStatusCol: {
    marginLeft: 10,
  },
  rowDueBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 9,
  },
  rowDueBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0788F5',
  },
  rowTakenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
  },
  rowTakenBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#059669',
  },
  rowSkippedBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
  },
  rowSkippedBadgeText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  multiRowSeparator: {
    height: 1,
    backgroundColor: '#F8FAFC',
    marginLeft: 68,
  },
  multiCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  multiCardFooterText: {
    fontSize: 12,
    color: '#8A8991',
  },

  // ---------------------------------------------------------------------------
  // Bottom Slide-to-Take & Secondary Section
  // ---------------------------------------------------------------------------
  bottomSection: {
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  sliderTrack: {
    height: 62,
    borderRadius: 31,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 4,
    position: 'relative',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sliderFill: {
    position: 'absolute',
    left: 4,
    top: 4,
    bottom: 4,
    backgroundColor: '#E0F2FE',
    borderRadius: 27,
  },
  sliderTextContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    width: '100%',
    paddingLeft: 40,
  },
  sliderGuideText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: -0.2,
  },
  sliderThumb: {
    position: 'absolute',
    left: 4,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0788F5',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0788F5',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  secondaryControlsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    justifyContent: 'center',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  cancelModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  cancelModeBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0788F5',
  },
  nextDoseCard: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  nextDoseIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextDoseTextCol: {
    flex: 1,
  },
  nextDoseTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  nextDoseSubtitle: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },

  // ---------------------------------------------------------------------------
  // Banners & Notifications
  // ---------------------------------------------------------------------------
  toastBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginVertical: 2,
  },
  toastText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  completedBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.successLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginVertical: 2,
  },
  completedText: {
    flex: 1,
    color: Colors.successDark,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: '700',
  },
  errorBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.errorLight,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginVertical: 2,
  },
  errorText: {
    flex: 1,
    color: Colors.errorDark,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
});
