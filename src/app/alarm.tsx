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
    : 'Started recently';

  const timeObj = useMemo(
    () => formatDoseTime(currentDose?.doseTime),
    [currentDose?.doseTime],
  );

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Top Hero: Ringing Badge & Digital Clock */}
          <View style={styles.heroSection}>
            <View style={styles.alarmStatusPill}>
              <Animated.View
                style={{
                  transform: [
                    {
                      rotate: bellRotate.interpolate({
                        inputRange: [-1, 0, 1],
                        outputRange: ['-18deg', '0deg', '18deg'],
                      }),
                    },
                  ],
                }}
              >
                <Ionicons name="notifications" size={15} color={Colors.primary} />
              </Animated.View>
              <Text style={styles.alarmStatusText}>MEDICATION REMINDER</Text>
              <View style={styles.statusDot} />
            </View>

            <View style={styles.timeRow}>
              <Text style={styles.timeDigits}>{timeObj.time}</Text>
              {timeObj.period ? (
                <View style={styles.periodBadge}>
                  <Text style={styles.periodText}>{timeObj.period}</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.timeTagline}>Time to take your scheduled dose</Text>

            {/* Simultaneous Doses Selector (When multiple unique doses are due) */}
            {doses.length > 1 && (
              <View style={styles.simultaneousSection}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dosePillRow}
                >
                  {doses.map((dose, idx) => {
                    const isSelected = idx === selectedIndex;
                    const isTaken = dose.status === 'taken';
                    const isSnoozed = dose.status === 'snoozed';
                    const isSkipped = dose.status === 'skipped';
                    return (
                      <TouchableOpacity
                        key={dose.id}
                        testID={`dose-pill-${dose.scheduleId}`}
                        onPress={() => setSelectedIndex(idx)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityLabel={`Select ${dose.medicineName} dose`}
                        style={[
                          styles.dosePill,
                          isSelected && styles.dosePillSelected,
                        ]}
                      >
                        <Ionicons
                          name={
                            isTaken
                              ? 'checkmark-circle'
                              : isSnoozed
                                ? 'alarm'
                                : isSkipped
                                  ? 'close-circle'
                                  : 'medical'
                          }
                          size={14}
                          color={
                            isTaken
                              ? Colors.success
                              : isSnoozed
                                ? Colors.warning
                                : isSkipped
                                  ? Colors.textTertiary
                                  : isSelected
                                    ? Colors.primary
                                    : Colors.textSecondary
                          }
                        />
                        <Text
                          style={[
                            styles.dosePillText,
                            isSelected && styles.dosePillTextSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {dose.medicineName}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Center: Hero Medicine Card */}
          <View style={styles.medicineCard}>
            <View style={styles.cardHeader}>
              <MedicineIcon
                form={(currentDose?.dosageForm as any) || 'tablet'}
                name={currentDose?.medicineName}
                size={58}
              />
              <View style={styles.cardHeaderInfo}>
                <View style={styles.cardBadgeRow}>
                  <View style={styles.doseBadge}>
                    <Text style={styles.doseBadgeText}>
                      {currentDose?.doseLabel || 'Scheduled Dose'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.medicineTitle} numberOfLines={2}>
                  {currentDose?.medicineName || 'Medication'}
                </Text>
                <Text style={styles.medicineDoseSubtitle}>
                  {currentDose?.amount || '1 dose'}
                </Text>
              </View>
            </View>

            <View style={styles.cardSpecsPanel}>
              <View style={styles.specItem}>
                <View style={styles.specIconBadge}>
                  <Ionicons name="calendar-outline" size={17} color={Colors.primary} />
                </View>
                <View style={styles.specContent}>
                  <Text style={styles.specLabel}>Schedule</Text>
                  <Text style={styles.specValue}>{recurrenceLabel}</Text>
                </View>
              </View>

              <View style={styles.specDivider} />

              <View style={styles.specItem}>
                <View style={styles.specIconBadge}>
                  <Ionicons name="fitness-outline" size={17} color={Colors.primary} />
                </View>
                <View style={styles.specContent}>
                  <Text style={styles.specLabel}>Instruction</Text>
                  <Text style={styles.specValue}>Take {doseInstruction} with water</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Alerts & Feedback Messages */}
          {toastMessage && (
            <View style={styles.toastBanner}>
              <Ionicons name="information-circle-outline" size={18} color={Colors.primary} />
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
                size={18}
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
              <Ionicons name="alert-circle-outline" size={18} color={Colors.error} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* Bottom Actions Area */}
          <View style={styles.bottomSection}>
            {/* Primary Action: Mark as Taken */}
            <Animated.View style={{ transform: [{ scale: chimeScale }], width: '100%' }}>
              <TouchableOpacity
                style={styles.takeButton}
                onPress={executeTakeDose}
                disabled={isProcessing}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Mark as Taken"
              >
                <View style={styles.takeButtonIconBox}>
                  <Ionicons name="checkmark" size={24} color={Colors.primary} />
                </View>
                <Text style={styles.takeButtonText}>Mark as Taken</Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Secondary Action Row: Snooze & Skip */}
            <View style={styles.secondaryActionsRow}>
              <TouchableOpacity
                style={styles.snoozeButton}
                onPress={executeSnooze}
                disabled={isProcessing}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={`Snooze for ${snoozeMinutes} minutes`}
              >
                <Ionicons name="alarm-outline" size={19} color={Colors.textPrimary} />
                <Text style={styles.snoozeButtonText}>Snooze ({snoozeMinutes}m)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.skipButton}
                onPress={executeSkipDose}
                disabled={isProcessing}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Skip this dose"
              >
                <Ionicons name="close-circle-outline" size={19} color={Colors.error} />
                <Text style={styles.skipButtonText}>Skip Dose</Text>
              </TouchableOpacity>
            </View>

            {/* Take All Button (If multiple unique simultaneous doses exist) */}
            {pendingDoses.length > 1 && (
              <TouchableOpacity
                testID="take-all-button"
                style={styles.takeAllButton}
                onPress={executeTakeAll}
                disabled={isProcessing}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark-done" size={18} color={Colors.primary} />
                <Text style={styles.takeAllButtonText}>
                  Mark all {pendingDoses.length} doses as taken
                </Text>
              </TouchableOpacity>
            )}

            {/* Next Upcoming Dose Preview Bar */}
            {nextDose && (
              <View style={styles.nextDoseBar}>
                <View style={styles.nextDoseIconWrap}>
                  <Ionicons name="time-outline" size={16} color={Colors.primary} />
                </View>
                <View style={styles.nextDoseInfo}>
                  <Text style={styles.nextDoseTitle}>Next: {nextDose.medicineName}</Text>
                  <Text style={styles.nextDoseSubtitle}>
                    {nextDose.doseTime || 'Upcoming'} · {nextDose.amount || '1 dose'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
    gap: 16,
  },

  // ---------------------------------------------------------------------------
  // Top Hero: Ringing Badge & Digital Clock
  // ---------------------------------------------------------------------------
  heroSection: {
    alignItems: 'center',
    width: '100%',
    paddingTop: 4,
  },
  alarmStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  alarmStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  timeDigits: {
    fontSize: 64,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
    lineHeight: 72,
  },
  periodBadge: {
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'center',
    ...Shadows.subtle,
  },
  periodText: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.primary,
  },
  timeTagline: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },

  // ---------------------------------------------------------------------------
  // Simultaneous Doses Pill Selector
  // ---------------------------------------------------------------------------
  simultaneousSection: {
    width: '100%',
    marginTop: 12,
  },
  dosePillRow: {
    gap: 8,
    paddingHorizontal: 4,
  },
  dosePill: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dosePillSelected: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  dosePillText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.textPrimary,
    maxWidth: 140,
  },
  dosePillTextSelected: {
    color: Colors.primaryDark,
  },

  // ---------------------------------------------------------------------------
  // Center: Hero Medicine Card
  // ---------------------------------------------------------------------------
  medicineCard: {
    width: '100%',
    backgroundColor: Colors.cardBackground,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
    gap: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  cardHeaderInfo: {
    flex: 1,
  },
  cardBadgeRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  doseBadge: {
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  doseBadgeText: {
    color: Colors.primary,
    fontSize: 11.5,
    fontWeight: '700',
  },
  medicineTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    lineHeight: 26,
    letterSpacing: -0.2,
  },
  medicineDoseSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginTop: 2,
  },
  cardSpecsPanel: {
    backgroundColor: Colors.cardBackgroundSecondary,
    borderRadius: Radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 8,
  },
  specItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 2,
  },
  specIconBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  specContent: {
    flex: 1,
  },
  specLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  specValue: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 1,
  },
  specDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginLeft: 40,
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
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toastText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  completedBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.successLight,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  completedText: {
    flex: 1,
    color: Colors.successDark,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  errorBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.errorLight,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorText: {
    flex: 1,
    color: Colors.errorDark,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
  },

  // ---------------------------------------------------------------------------
  // Bottom Action Controls
  // ---------------------------------------------------------------------------
  bottomSection: {
    width: '100%',
    gap: 12,
  },
  takeButton: {
    minHeight: 58,
    width: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 14,
    elevation: 6,
  },
  takeButtonIconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  takeButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  snoozeButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    ...Shadows.subtle,
  },
  snoozeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  skipButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: Radius.pill,
    backgroundColor: '#FDECEE',
    borderWidth: 1,
    borderColor: '#FCD7DA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  skipButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.error,
  },
  takeAllButton: {
    width: '100%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  takeAllButtonText: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '700',
  },
  nextDoseBar: {
    width: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.lg,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
    ...Shadows.subtle,
  },
  nextDoseIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextDoseInfo: {
    flex: 1,
  },
  nextDoseTitle: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  nextDoseSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1,
  },
});
