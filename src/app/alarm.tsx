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
    : 'Started recently';

  const formattedCurrentTime = useMemo(
    () => formatTime12Hour(currentDose?.doseTime || '08:00'),
    [currentDose?.doseTime],
  );

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Header (HealthMate Header style) */}
          <View style={styles.header}>
            <View style={styles.headerBadgeRow}>
              <View style={styles.ringingBadge}>
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
                  <Ionicons name="notifications" size={13} color={Colors.primary} />
                </Animated.View>
                <Text style={styles.ringingBadgeText}>MEDICATION DUE NOW</Text>
              </View>
              <Text style={styles.headerTime}>{formattedCurrentTime}</Text>
            </View>

            <Text style={styles.headerTitle}>Time for your medicine</Text>
            <Text style={styles.headerSubtitle}>
              Scheduled for {formattedCurrentTime} · {currentDose?.doseLabel || 'Prescription dose'}
            </Text>
          </View>

          {/* Feedback & Error Banners */}
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

          {/* Hero Due Card (Following NextMedicationCard & Medicine Details pattern) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Due Medication</Text>
            <View style={styles.medCard}>
              {/* Top Row: Icon, Info, Time */}
              <View style={styles.cardTopRow}>
                <View style={styles.iconContainer}>
                  <MedicineIcon
                    form={(currentDose?.dosageForm as any) || 'tablet'}
                    name={currentDose?.medicineName}
                    size={48}
                  />
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardMedName} numberOfLines={1}>
                    {currentDose?.medicineName || 'Medication'}
                  </Text>
                  <Text style={styles.cardMedDose}>
                    {currentDose?.amount || '1 dose'}
                  </Text>
                </View>
                <Text style={styles.cardTimeText}>{formattedCurrentTime}</Text>
              </View>

              {/* Schedule note */}
              <Text style={styles.scheduleNote}>
                From your {recurrenceLabel.toLowerCase()} schedule
              </Text>

              {/* Divider */}
              <View style={styles.cardDivider} />

              {/* Specs Rows (HealthMate infoRow style) */}
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Dosage form</Text>
                <Text style={styles.infoValue}>
                  {currentDose?.dosageForm
                    ? currentDose.dosageForm.charAt(0).toUpperCase() +
                      currentDose.dosageForm.slice(1)
                    : 'Tablet'}
                </Text>
              </View>

              <View style={styles.rowDivider} />

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Instructions</Text>
                <Text style={styles.infoValue}>Take {doseInstruction} with water</Text>
              </View>

              <View style={styles.rowDivider} />

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Frequency</Text>
                <Text style={styles.infoValue}>{recurrenceLabel}</Text>
              </View>
            </View>
          </View>

          {/* Simultaneous Doses Section (If more than 1 dose is ringing) */}
          {doses.length > 1 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                All Due Medications ({doses.length})
              </Text>
              <View style={styles.timelineCard}>
                {doses.map((dose, index) => {
                  const isSelected = index === selectedIndex;
                  const isLast = index === doses.length - 1;
                  return (
                    <TouchableOpacity
                      key={dose.id}
                      style={[
                        styles.timelineItem,
                        !isLast && styles.timelineItemDivider,
                        isSelected && styles.timelineItemSelected,
                      ]}
                      onPress={() => setSelectedIndex(index)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.timelineItemLeft}>
                        <Text
                          style={[
                            styles.timelineItemName,
                            isSelected && styles.timelineItemNameActive,
                          ]}
                        >
                          {dose.medicineName}
                        </Text>
                        <Text style={styles.timelineItemSub}>
                          {formatTime12Hour(dose.doseTime || '08:00')} · {dose.amount}
                        </Text>
                      </View>
                      <StatusBadge
                        status={dose.status === 'pending' ? 'upcoming' : (dose.status as any)}
                        label={
                          dose.status === 'pending'
                            ? isSelected
                              ? 'Selected'
                              : 'Due'
                            : undefined
                        }
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Actions Container */}
          <View style={styles.actionsContainer}>
            {/* Primary Action Button */}
            <Animated.View style={{ transform: [{ scale: chimeScale }], width: '100%' }}>
              <TouchableOpacity
                style={styles.primaryActionButton}
                onPress={executeTakeDose}
                disabled={isProcessing}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Mark as Taken"
              >
                <Ionicons
                  name="checkmark-circle"
                  size={20}
                  color="#FFFFFF"
                  style={{ marginRight: 8 }}
                />
                <Text style={styles.primaryActionButtonText}>Mark as Taken</Text>
              </TouchableOpacity>
            </Animated.View>

            {/* Secondary Buttons Row */}
            <View style={styles.secondaryActionsRow}>
              <TouchableOpacity
                style={styles.snoozeButton}
                onPress={executeSnooze}
                disabled={isProcessing}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Snooze for ${snoozeMinutes} minutes`}
              >
                <Ionicons
                  name="alarm-outline"
                  size={18}
                  color={Colors.textPrimary}
                  style={{ marginRight: 6 }}
                />
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
                <Ionicons
                  name="close-circle-outline"
                  size={18}
                  color={Colors.error}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.skipButtonText}>Skip Dose</Text>
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
                  size={18}
                  color={Colors.primary}
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.takeAllButtonText}>
                  Mark all {pendingDoses.length} doses as taken
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Next Up Today (TodayTimeline style) */}
          {nextDose && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Next up today</Text>
              <View style={styles.nextCard}>
                <View style={styles.nextIconBox}>
                  <MaterialCommunityIcons
                    name="pill"
                    size={20}
                    color={Colors.primary}
                    style={{ transform: [{ rotate: '-45deg' }] }}
                  />
                </View>
                <View style={styles.nextInfo}>
                  <Text style={styles.nextMedName}>{nextDose.medicineName}</Text>
                  <Text style={styles.nextDetails}>
                    {formatTime12Hour(nextDose.doseTime || '08:00')} · {nextDose.amount || '1 dose'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
              </View>
            </View>
          )}
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
  scrollContent: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.huge,
  },

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------
  header: {
    marginBottom: Spacing.lg,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  ringingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  ringingBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
    letterSpacing: 0.5,
  },
  headerTime: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.primary,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.textPrimary,
    lineHeight: 30,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },

  // ---------------------------------------------------------------------------
  // Sections & Cards (Following NextMedicationCard & TodayTimeline)
  // ---------------------------------------------------------------------------
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 8,
  },
  medCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
    elevation: 3,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.iconContainer,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardInfo: {
    flex: 1,
    marginLeft: 12,
  },
  cardMedName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  cardMedDose: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  cardTimeText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.primary,
  },
  scheduleNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 12,
    marginBottom: 12,
  },
  cardDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginBottom: 6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  infoLabel: {
    fontSize: 13.5,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 13.5,
    color: Colors.textPrimary,
    fontWeight: '600',
    textAlign: 'right',
  },
  rowDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
  },

  // ---------------------------------------------------------------------------
  // Simultaneous Timeline Card (TodayTimeline style)
  // ---------------------------------------------------------------------------
  timelineCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
    elevation: 3,
    overflow: 'hidden',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  timelineItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  timelineItemSelected: {
    backgroundColor: Colors.primaryLight,
  },
  timelineItemLeft: {
    flex: 1,
    paddingRight: 12,
  },
  timelineItemName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  timelineItemNameActive: {
    color: Colors.primaryDark,
  },
  timelineItemSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  // ---------------------------------------------------------------------------
  // Action Buttons
  // ---------------------------------------------------------------------------
  actionsContainer: {
    marginBottom: Spacing.lg,
    gap: 10,
  },
  primaryActionButton: {
    width: '100%',
    height: 50,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.card,
  },
  primaryActionButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  snoozeButton: {
    flex: 1,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  snoozeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  skipButton: {
    flex: 1,
    height: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: '#FCD7DA',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.error,
  },
  takeAllButton: {
    width: '100%',
    height: 46,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  takeAllButtonText: {
    fontSize: 13.5,
    fontWeight: '600',
    color: Colors.primaryDark,
  },

  // ---------------------------------------------------------------------------
  // Next Up Card
  // ---------------------------------------------------------------------------
  nextCard: {
    backgroundColor: Colors.cardBackground,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    ...Shadows.card,
  },
  nextIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: Colors.iconContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextInfo: {
    flex: 1,
    marginLeft: 12,
  },
  nextMedName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  nextDetails: {
    fontSize: 12.5,
    color: Colors.textSecondary,
    marginTop: 2,
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
    paddingVertical: 10,
    marginBottom: Spacing.md,
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
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: Spacing.md,
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
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: Spacing.md,
  },
  errorText: {
    flex: 1,
    color: Colors.errorDark,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '600',
  },
});
