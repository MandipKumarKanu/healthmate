import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  instanceId?: string;
  sourceScheduleId?: string;
  status: 'pending' | 'taken' | 'snoozed' | 'skipped';
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
      setIsProcessing(false);
    }
  }, [isProcessing, currentDose, doses, router]);

  // Action: Snooze Alarm
  const executeSnooze = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

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
    }
  }, [isProcessing, currentDose, doses, snoozeMinutes, router]);

  // Action: Skip Dose
  const executeSkipDose = useCallback(async () => {
    if (isProcessing || !currentDose) return;
    setIsProcessing(true);
    setErrorMessage(null);

    try {
      Vibration.vibrate(Platform.OS === 'android' ? [0, 35, 35, 35] : 70);
      await nativeAlarmService.stopAlarm(currentDose.scheduleId, currentDose.doseTime);
      if (currentDose.scheduleId) {
        await nativeAlarmService.cancelSnoozesForSchedule(currentDose.scheduleId);
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
      setIsProcessing(false);
    }
  }, [isProcessing, currentDose, doses, router]);

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

  // Check if all pending doses are taken
  const allDosesCount = doses.length;
  const pendingCount = pendingDoses.length;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screenContainer}>
          {/* Top Bar: Quiet, elegant */}
          <View style={styles.topBar}>
            <View style={styles.brandRow}>
              <View style={styles.brandDot} />
              <Text style={styles.brandText}>HealthMate</Text>
            </View>

            <TouchableOpacity
              style={styles.dismissButton}
              onPress={handleDismiss}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Dismiss Alarm"
            >
              <Ionicons name="close" size={20} color="#8A8991" />
            </TouchableOpacity>
          </View>

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

          {/* Hero Header: Human, Clear, Dignified */}
          <View style={styles.heroHeader}>
            <Text style={styles.heroTimeSub}>
              {currentDose?.doseLabel ? `${currentDose.doseLabel} · ` : ''}
              {formattedCurrentTime}
            </Text>
            <Text style={styles.heroTitle}>
              {allDosesCount > 1 ? 'Morning Medications' : 'Time for Medication'}
            </Text>
            <Text style={styles.heroSubtitle}>
              {allDosesCount > 1
                ? `${pendingCount} dose${pendingCount === 1 ? '' : 's'} scheduled for right now`
                : 'Take with a glass of water as prescribed'}
            </Text>
          </View>

          {/* Main Medications Card (Apple Health Grouped Inset Card) */}
          <View style={styles.medicationsCard}>
            {doses.map((dose, index) => {
              const isSelected = index === selectedIndex;
              const isTaken = dose.status === 'taken';
              const isSkipped = dose.status === 'skipped';
              const isLast = index === doses.length - 1;

              return (
                <View key={dose.id}>
                  <TouchableOpacity
                    style={[
                      styles.medicationRow,
                      isSelected && doses.length > 1 && styles.medicationRowSelected,
                    ]}
                    onPress={() => setSelectedIndex(index)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.medIconBox,
                        isTaken && styles.medIconBoxTaken,
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="pill"
                        size={22}
                        color={isTaken ? Colors.success : Colors.primary}
                        style={{ transform: [{ rotate: '-45deg' }] }}
                      />
                    </View>

                    <View style={styles.medDetailsCol}>
                      <Text
                        style={[
                          styles.medNameText,
                          (isTaken || isSkipped) && styles.medNameMuted,
                        ]}
                        numberOfLines={1}
                      >
                        {dose.medicineName}
                      </Text>
                      <Text style={styles.medDoseText} numberOfLines={1}>
                        {dose.amount}
                      </Text>
                    </View>

                    {/* Status indicator on right */}
                    <View style={styles.medStatusCol}>
                      {isTaken ? (
                        <View style={styles.takenBadge}>
                          <Ionicons name="checkmark" size={14} color={Colors.success} />
                          <Text style={styles.takenBadgeText}>Taken</Text>
                        </View>
                      ) : isSkipped ? (
                        <View style={styles.skippedBadge}>
                          <Text style={styles.skippedBadgeText}>Skipped</Text>
                        </View>
                      ) : (
                        <View style={styles.dueBadgePill}>
                          <Text style={styles.dueBadgePillText}>Due</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>

                  {!isLast && <View style={styles.rowSeparator} />}
                </View>
              );
            })}

            {/* Subtle schedule reassurance note */}
            <View style={styles.cardFooter}>
              <Ionicons name="calendar-outline" size={14} color="#8A8991" />
              <Text style={styles.cardFooterText}>
                {recurrenceLabel} · {startedLabel}
              </Text>
            </View>
          </View>

          {/* Action Buttons: Bold, Clean, Purposeful */}
          <View style={styles.actionsContainer}>
            {/* Primary Action Button */}
            <Animated.View style={{ transform: [{ scale: chimeScale }], width: '100%' }}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={pendingCount > 1 ? executeTakeAll : executeTakeDose}
                disabled={isProcessing}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Mark as Taken"
              >
                <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                <Text style={styles.primaryButtonText}>
                  {pendingCount > 1
                    ? `Take All (${pendingCount} Medications)`
                    : 'Mark as Taken'}
                </Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Secondary Actions: Snooze & Skip */}
            <View style={styles.secondaryRow}>
              <TouchableOpacity
                style={styles.secondaryCardButton}
                onPress={executeSnooze}
                disabled={isProcessing}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Snooze for ${snoozeMinutes} minutes`}
              >
                <MaterialCommunityIcons name="alarm-snooze" size={18} color="#111116" />
                <Text style={styles.secondaryButtonText}>Snooze {snoozeMinutes}m</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryCardButton}
                onPress={executeSkipDose}
                disabled={isProcessing}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Skip this dose"
              >
                <Ionicons name="close" size={18} color="#E05B67" />
                <Text style={[styles.secondaryButtonText, { color: '#E05B67' }]}>
                  Skip for now
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Upcoming Dose Preview */}
          {nextDose && (
            <View style={styles.upcomingDoseBar}>
              <Text style={styles.upcomingLabel}>Next up</Text>
              <Text style={styles.upcomingDetails} numberOfLines={1}>
                {nextDose.medicineName} · {formatTime12Hour(nextDose.doseTime || '08:00')}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F1F7',
  },
  safeArea: {
    flex: 1,
  },
  screenContainer: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },

  // ---------------------------------------------------------------------------
  // Top Bar
  // ---------------------------------------------------------------------------
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  brandDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0788F5',
  },
  brandText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A8991',
    letterSpacing: -0.2,
  },
  dismissButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEBF0',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ---------------------------------------------------------------------------
  // Hero Header
  // ---------------------------------------------------------------------------
  heroHeader: {
    marginVertical: 10,
  },
  heroTimeSub: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#0788F5',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111116',
    letterSpacing: -0.6,
  },
  heroSubtitle: {
    fontSize: 14.5,
    color: '#8A8991',
    marginTop: 4,
    lineHeight: 20,
  },

  // ---------------------------------------------------------------------------
  // Medications Card (Apple Health Grouped Inset)
  // ---------------------------------------------------------------------------
  medicationsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ECEBF0',
    ...Shadows.card,
    elevation: 2,
    overflow: 'hidden',
    marginVertical: 8,
  },
  medicationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  medicationRowSelected: {
    backgroundColor: '#F8FAFC',
  },
  medIconBox: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: '#EAF4FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medIconBoxTaken: {
    backgroundColor: '#E8F8EE',
  },
  medDetailsCol: {
    flex: 1,
    marginLeft: 12,
  },
  medNameText: {
    fontSize: 16.5,
    fontWeight: '700',
    color: '#111116',
    letterSpacing: -0.2,
  },
  medNameMuted: {
    color: '#8A8991',
    textDecorationLine: 'line-through',
  },
  medDoseText: {
    fontSize: 13,
    color: '#8A8991',
    marginTop: 2,
  },
  medStatusCol: {
    marginLeft: 10,
  },
  dueBadgePill: {
    backgroundColor: '#EAF4FE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  dueBadgePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0788F5',
  },
  takenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F8EE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  takenBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#23964E',
  },
  skippedBadge: {
    backgroundColor: '#F0EFEF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  skippedBadgeText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#8A8991',
  },
  rowSeparator: {
    height: 1,
    backgroundColor: '#F3F2F6',
    marginLeft: 72,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F8F8FC',
    borderTopWidth: 1,
    borderTopColor: '#ECEBF0',
  },
  cardFooterText: {
    fontSize: 12,
    color: '#8A8991',
  },

  // ---------------------------------------------------------------------------
  // Action Buttons
  // ---------------------------------------------------------------------------
  actionsContainer: {
    gap: 10,
    marginVertical: 6,
  },
  primaryButton: {
    width: '100%',
    height: 52,
    borderRadius: 16,
    backgroundColor: '#0788F5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.card,
    elevation: 3,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryCardButton: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECEBF0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    ...Shadows.subtle,
  },
  secondaryButtonText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: '#111116',
  },

  // ---------------------------------------------------------------------------
  // Upcoming Dose Preview Bar
  // ---------------------------------------------------------------------------
  upcomingDoseBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#ECEBF0',
  },
  upcomingLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A8991',
  },
  upcomingDetails: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#111116',
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
