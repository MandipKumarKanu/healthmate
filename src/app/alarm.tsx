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

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.screenContainer}>
          {/* Top Header Bar */}
          <View style={styles.topHeader}>
            <View style={styles.reminderStatusPill}>
              <View style={styles.livePulseDot} />
              <Text style={styles.reminderStatusText}>MEDICINE REMINDER</Text>
            </View>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={handleDismiss}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Dismiss Alarm"
            >
              <Ionicons name="close" size={18} color="#64748B" />
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

          {/* Hero Clock & Greeting Section */}
          <View style={styles.heroClockSection}>
            <View style={styles.ambientGlow} />
            <View style={styles.clockTimeRow}>
              <Text style={styles.clockTimeLarge}>{clockDisplayTime}</Text>
              <View style={styles.dosePeriodBadge}>
                <Text style={styles.dosePeriodBadgeText}>
                  {currentDose?.doseLabel || 'Morning Dose'}
                </Text>
              </View>
            </View>
            <Text style={styles.clockSubtitle}>Time to take your scheduled dose</Text>
          </View>

          {/* Simultaneous Doses Tabs (if multiple pending) */}
          {doses.length > 1 && (
            <View style={styles.simultaneousSection}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.simultaneousPillRow}
              >
                {doses.map((dose, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <TouchableOpacity
                      key={dose.id}
                      onPress={() => setSelectedIndex(idx)}
                      style={[
                        styles.simultaneousPill,
                        isSelected && styles.simultaneousPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.simultaneousPillText,
                          isSelected && styles.simultaneousPillTextActive,
                        ]}
                      >
                        {dose.medicineName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Main Medicine Card */}
          <View style={styles.medCard}>
            {/* Header: Icon, Name, Dose Amount */}
            <View style={styles.cardHeader}>
              <View style={styles.medIconContainer}>
                <MaterialCommunityIcons name="pill" size={28} color="#0788F5" />
              </View>
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardMedName} numberOfLines={1}>
                  {currentDose?.medicineName || 'Metformin'}
                </Text>
                <Text style={styles.cardDoseSubtitle} numberOfLines={1}>
                  {currentDose?.amount || '500 mg · 1 tablet'}
                </Text>
              </View>
              <View style={styles.dueBadge}>
                <View style={styles.dueBadgeDot} />
                <Text style={styles.dueBadgeText}>Due now</Text>
              </View>
            </View>

            {/* Visual Specs Badges Grid (2-column pills) */}
            <View style={styles.specsGrid}>
              <View style={styles.specBox}>
                <Ionicons name="repeat-outline" size={17} color="#0788F5" />
                <View style={styles.specBoxTextCol}>
                  <Text style={styles.specBoxLabel}>FREQUENCY</Text>
                  <Text style={styles.specBoxValue} numberOfLines={1}>
                    {recurrenceLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.specBox}>
                <Ionicons name="water-outline" size={17} color="#0788F5" />
                <View style={styles.specBoxTextCol}>
                  <Text style={styles.specBoxLabel}>DOSAGE</Text>
                  <Text style={styles.specBoxValue} numberOfLines={1}>
                    Take {doseInstruction}
                  </Text>
                </View>
              </View>
            </View>

            {/* Schedule Prescription Footnote */}
            <View style={styles.scheduleStrip}>
              <Ionicons name="shield-checkmark-outline" size={15} color="#10B981" />
              <Text style={styles.scheduleStripText} numberOfLines={1}>
                Saved prescription · {startedLabel}
              </Text>
            </View>

            {/* Reassurance Insight Bar */}
            <View style={styles.insightBar}>
              <Ionicons name="sparkles" size={15} color="#0788F5" />
              <Text style={styles.insightBarText}>
                Keeping your routine consistent maintains optimal health.
              </Text>
            </View>
          </View>

          {/* Action Buttons Section */}
          <View style={styles.actionsSection}>
            {/* Primary Action Button: Mark as Taken (Hero Pulsing Pill) */}
            <Animated.View style={{ transform: [{ scale: chimeScale }], width: '100%' }}>
              <TouchableOpacity
                style={styles.heroTakenButton}
                onPress={executeTakeDose}
                disabled={isProcessing}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Mark as Taken"
              >
                <View style={styles.heroCheckIconCircle}>
                  <Ionicons name="checkmark" size={20} color="#0788F5" />
                </View>
                <Text style={styles.heroTakenButtonText}>Mark as Taken</Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Secondary Actions: Snooze & Skip Side-by-Side */}
            <View style={styles.secondaryActionsRow}>
              <TouchableOpacity
                style={styles.snoozeButton}
                onPress={executeSnooze}
                disabled={isProcessing}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Snooze for ${snoozeMinutes} minutes`}
              >
                <MaterialCommunityIcons name="alarm-snooze" size={20} color="#334155" />
                <Text style={styles.snoozeButtonText}>Snooze ({snoozeMinutes}m)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.skipButton}
                onPress={executeSkipDose}
                disabled={isProcessing}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Skip this dose"
              >
                <Ionicons name="close-circle-outline" size={19} color="#E11D48" />
                <Text style={styles.skipButtonText}>Skip for now</Text>
              </TouchableOpacity>
            </View>

            {/* Take All Button (When multiple unique doses exist) */}
            {pendingDoses.length > 1 && (
              <TouchableOpacity
                testID="take-all-button"
                style={styles.takeAllButton}
                onPress={executeTakeAll}
                disabled={isProcessing}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="checkmark-done"
                  size={16}
                  color={Colors.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.takeAllButtonText}>
                  Mark all {pendingDoses.length} doses as taken
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Bottom Next Up Preview Card */}
          <View style={styles.nextCard}>
            <View style={styles.nextIconBox}>
              <MaterialCommunityIcons name="pill" size={16} color="#0788F5" />
            </View>
            <View style={styles.nextInfo}>
              <Text style={styles.nextMedName} numberOfLines={1}>
                Next: {displayNextDose.medicineName}
              </Text>
              <Text style={styles.nextDetails} numberOfLines={1}>
                {displayNextDose.doseTime} · {displayNextDose.amount}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },

  // ---------------------------------------------------------------------------
  // Top Header Bar
  // ---------------------------------------------------------------------------
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  reminderStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  livePulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#0788F5',
  },
  reminderStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0788F5',
    letterSpacing: 0.6,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },

  // ---------------------------------------------------------------------------
  // Hero Clock & Due Status
  // ---------------------------------------------------------------------------
  heroClockSection: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginVertical: 6,
  },
  ambientGlow: {
    position: 'absolute',
    width: 220,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(7, 136, 245, 0.08)',
  },
  clockTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clockTimeLarge: {
    fontSize: 54,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -1.5,
  },
  dosePeriodBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  dosePeriodBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0788F5',
  },
  clockSubtitle: {
    fontSize: 13.5,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },

  // ---------------------------------------------------------------------------
  // Main Medicine Card
  // ---------------------------------------------------------------------------
  medCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  medIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderCopy: {
    flex: 1,
  },
  cardMedName: {
    fontSize: 21,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  cardDoseSubtitle: {
    fontSize: 13.5,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  dueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  dueBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  dueBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#059669',
  },

  // Specs Grid (Clean 2-column card badges)
  specsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  specBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  specBoxTextCol: {
    flex: 1,
  },
  specBoxLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.5,
  },
  specBoxValue: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#1E293B',
    marginTop: 1,
  },

  // Prescription strip
  scheduleStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 2,
  },
  scheduleStripText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    flex: 1,
  },

  // Reassurance Bar
  insightBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginTop: 12,
  },
  insightBarText: {
    fontSize: 12,
    color: '#1E40AF',
    flex: 1,
    lineHeight: 16,
    fontWeight: '500',
  },

  // ---------------------------------------------------------------------------
  // Action Buttons Section
  // ---------------------------------------------------------------------------
  actionsSection: {
    gap: 10,
    marginVertical: 4,
  },
  heroTakenButton: {
    width: '100%',
    height: 56,
    borderRadius: 28,
    backgroundColor: '#0788F5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0788F5',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  heroCheckIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  heroTakenButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  snoozeButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  snoozeButtonText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#334155',
  },
  skipButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFF1F2',
    borderWidth: 1,
    borderColor: '#FFE4E6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  skipButtonText: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#E11D48',
  },
  takeAllButton: {
    width: '100%',
    height: 42,
    borderRadius: 21,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BAE6FD',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  takeAllButtonText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#0788F5',
  },

  // ---------------------------------------------------------------------------
  // Bottom Next Up Preview Card
  // ---------------------------------------------------------------------------
  nextCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  nextIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextInfo: {
    flex: 1,
    marginLeft: 10,
  },
  nextMedName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  nextDetails: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },

  // ---------------------------------------------------------------------------
  // Simultaneous Doses Tabs
  // ---------------------------------------------------------------------------
  simultaneousSection: {
    marginVertical: 4,
  },
  simultaneousPillRow: {
    gap: 8,
    paddingVertical: 2,
  },
  simultaneousPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  simultaneousPillActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  simultaneousPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1E293B',
  },
  simultaneousPillTextActive: {
    color: Colors.primaryDark,
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
