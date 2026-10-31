import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Animated,
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

  const [completedAction, setCompletedAction] = useState<'taken' | 'snooze' | 'skipped' | null>(null);
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
  const [chimeScale] = useState(() => new Animated.Value(1));
  const [pulseGlow] = useState(() => new Animated.Value(0.4));

  // Clock ticker & scoped lockscreen window overlap
  useEffect(() => {
    void nativeAlarmService.setLockScreenOverlap(true);

    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // Prevent exiting the alarm or backing into the app via back button on lock screen
      return true;
    });

    return () => {
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
  const nextDose = pendingDoses.find((dose) => dose.id !== currentDose?.id);
  const doseInstruction = currentDose?.amount?.includes('·')
    ? currentDose.amount.split('·').slice(1).join('·').trim()
    : currentDose?.amount || 'As directed on your label';
  const recurrenceLabel =
    currentSchedule?.recurrence === 'daily'
      ? 'Every day'
      : currentSchedule?.recurrence === 'weekly'
        ? 'Every week'
        : currentSchedule?.recurrence === 'monthly'
          ? 'Every month'
          : currentSchedule?.recurrence === 'once'
            ? 'One-time reminder'
            : 'Saved schedule';
  const startedLabel = currentSchedule?.startDate
    ? new Date(`${currentSchedule.startDate}T00:00:00`).toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Your saved schedule';
  const themeColors = {
    bg: isDark ? '#0D1017' : Colors.alarmBackground,
    surface: isDark ? '#171B26' : Colors.cardBackground,
    surfaceTint: isDark ? '#20283A' : Colors.alarmSurfaceTint,
    border: isDark ? '#2B3448' : Colors.alarmBorder,
    textPrimary: isDark ? '#F5F7FA' : Colors.textPrimary,
    textSecondary: isDark ? '#B8C0D0' : Colors.alarmMutedBlue,
  };

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={styles.header}>
            <View style={styles.brandLockup}>
              <View style={styles.brandIcon}>
                <MaterialCommunityIcons name="heart-pulse" size={35} color="#FFFFFF" />
              </View>
              <Text style={[styles.brandName, { color: themeColors.textSecondary }]}>HealthMate AI</Text>
            </View>
            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: themeColors.surfaceTint }]}
              onPress={executeSkipDose}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel="Dismiss reminder and skip this dose"
              accessibilityState={{ disabled: isProcessing }}
              activeOpacity={0.75}
            >
              <Ionicons name="close" size={28} color={themeColors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.timeHero}>
            <View style={[styles.timeHaloLarge, { borderColor: themeColors.border }]} />
            <View style={[styles.timeHaloSmall, { borderColor: themeColors.border }]} />
            <Text style={[styles.screenTitle, { color: themeColors.textSecondary }]}>Medicine Reminder</Text>
            <View style={styles.scheduledTimeRow}>
              <View style={styles.timeMarks}>
                <View style={styles.timeMarkDiagonal} />
                <View style={styles.timeMarkHorizontal} />
                <View style={styles.timeMarkDiagonal} />
              </View>
              <Text style={[styles.scheduledTime, { color: themeColors.textPrimary }]}>
                {currentDose?.doseTime || '--:--'}
              </Text>
              <View style={[styles.timeMarks, styles.timeMarksRight]}>
                <View style={styles.timeMarkDiagonal} />
                <View style={styles.timeMarkHorizontal} />
                <View style={styles.timeMarkDiagonal} />
              </View>
            </View>
            <Text style={[styles.timeSubtitle, { color: themeColors.textSecondary }]}>Time to take your medicine</Text>
          </View>

          {doses.length > 1 && (
            <View style={styles.simultaneousSection}>
              <Text style={[styles.simultaneousHeaderText, { color: themeColors.textSecondary }]}>
                {pendingDoses.length} of {doses.length} doses still need attention
              </Text>
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
                        { backgroundColor: isSelected ? Colors.primaryLight : themeColors.surface, borderColor: isSelected ? Colors.primary : themeColors.border },
                      ]}
                    >
                      <Ionicons
                        name={isTaken ? 'checkmark-circle' : isSnoozed ? 'alarm' : isSkipped ? 'close-circle' : 'medical-outline'}
                        size={16}
                        color={isTaken ? Colors.success : isSnoozed ? Colors.warning : isSkipped ? Colors.textTertiary : Colors.primary}
                      />
                      <Text style={[styles.dosePillText, { color: themeColors.textPrimary }]} numberOfLines={1}>
                        {dose.medicineName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          <View style={[styles.medicineCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
            <View style={styles.medicineHeader}>
              <View style={styles.medicineIconBox}>
                <MaterialCommunityIcons name="pill" size={42} color={Colors.primary} style={styles.pillIcon} />
              </View>
              <View style={styles.medicineHeading}>
                <Text style={[styles.medicineName, { color: themeColors.textPrimary }]} numberOfLines={2}>
                  {currentDose?.medicineName || 'Medication'}
                </Text>
                <Text style={[styles.medicineAmount, { color: themeColors.textSecondary }]} numberOfLines={1}>
                  {currentDose?.amount || '1 dose'}
                </Text>
              </View>
              <View style={styles.doseLabelBadge}>
                <Text style={styles.doseLabelText}>{currentDose?.doseLabel || 'Dose'}</Text>
              </View>
            </View>

            <View style={[styles.detailsPanel, { backgroundColor: themeColors.surfaceTint }]}>
              <View style={styles.detailRow}>
                <View style={styles.detailIconBox}>
                  <Ionicons name="calendar-outline" size={25} color={themeColors.textSecondary} />
                </View>
                <View style={styles.detailCopy}>
                  <Text style={[styles.detailTitle, { color: themeColors.textPrimary }]}>{recurrenceLabel}</Text>
                  <Text style={[styles.detailSubtitle, { color: themeColors.textSecondary }]}>Started {startedLabel}</Text>
                </View>
              </View>
              <View style={[styles.detailDivider, { backgroundColor: themeColors.border }]} />
              <View style={styles.detailRow}>
                <View style={styles.detailIconBox}>
                  <Ionicons name="document-text-outline" size={25} color={themeColors.textSecondary} />
                </View>
                <View style={styles.detailCopy}>
                  <Text style={[styles.detailTitle, { color: themeColors.textPrimary }]}>Take {doseInstruction}</Text>
                  <Text style={[styles.detailSubtitle, { color: themeColors.textSecondary }]}>As directed on your label</Text>
                </View>
              </View>
              <View style={[styles.detailDivider, { backgroundColor: themeColors.border }]} />
              <View style={styles.detailRow}>
                <View style={styles.detailIconBox}>
                  <Ionicons name="information-circle-outline" size={26} color={themeColors.textSecondary} />
                </View>
                <View style={styles.detailCopy}>
                  <Text style={[styles.detailTitle, { color: themeColors.textPrimary }]}>From your saved schedule</Text>
                  <Text style={[styles.detailSubtitle, { color: themeColors.textSecondary }]}>Follow your doctor’s instructions</Text>
                </View>
              </View>
            </View>
          </View>

          {toastMessage && (
            <View style={[styles.feedbackBanner, { backgroundColor: themeColors.surfaceTint }]}>
              <Ionicons name="information-circle-outline" size={22} color={Colors.primary} />
              <Text style={[styles.feedbackText, { color: themeColors.textSecondary }]}>{toastMessage}</Text>
            </View>
          )}

          {completedAction && (
            <View style={[styles.feedbackBanner, styles.completedBanner]}>
              <Ionicons
                name={completedAction === 'taken' ? 'checkmark-circle' : completedAction === 'snooze' ? 'alarm' : 'close-circle'}
                size={22}
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
              <Ionicons name="alert-circle-outline" size={21} color={Colors.error} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          <View style={[styles.encouragement, { backgroundColor: themeColors.surfaceTint }]}>
            <Ionicons name="sparkles-outline" size={25} color={Colors.primary} />
            <Text style={[styles.encouragementText, { color: themeColors.textSecondary }]}>Keeping your routine consistent helps you stay on track.</Text>
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={executeSnooze}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel={`Snooze for ${snoozeMinutes} minutes`}
              accessibilityState={{ disabled: isProcessing }}
              activeOpacity={0.75}
            >
              <View style={[styles.secondaryActionCircle, { backgroundColor: themeColors.surface }]}>
                <Ionicons name="alarm-outline" size={35} color={themeColors.textSecondary} />
              </View>
              <Text style={[styles.actionTitle, { color: themeColors.textPrimary }]}>Snooze</Text>
              <Text style={[styles.actionSubtitle, { color: themeColors.textSecondary }]}>{snoozeMinutes} minutes</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.primaryAction}
              onPress={executeTakeDose}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel="Mark dose as taken"
              accessibilityState={{ disabled: isProcessing }}
              activeOpacity={0.82}
            >
              <View style={styles.primaryActionRing}>
                <Animated.View style={[styles.primaryActionCircle, { transform: [{ scale: chimeScale }] }]}>
                  <Ionicons name="checkmark" size={60} color="#FFFFFF" />
                </Animated.View>
              </View>
              <Text style={[styles.primaryActionTitle, { color: themeColors.textPrimary }]}>Mark as Taken</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={executeSkipDose}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel="Skip this dose for now"
              accessibilityState={{ disabled: isProcessing }}
              activeOpacity={0.75}
            >
              <View style={[styles.secondaryActionCircle, styles.skipCircle, { backgroundColor: isDark ? '#2A1E27' : '#FFF4F5' }]}>
                <Ionicons name="close" size={40} color={Colors.error} />
              </View>
              <Text style={[styles.actionTitle, { color: themeColors.textPrimary }]}>Skip</Text>
              <Text style={[styles.actionSubtitle, { color: themeColors.textSecondary }]}>For now</Text>
            </TouchableOpacity>
          </View>

          {pendingDoses.length > 1 && (
            <TouchableOpacity
              testID="take-all-button"
              style={styles.takeAllButton}
              onPress={executeTakeAll}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel={`Mark all ${pendingDoses.length} due medications as taken`}
              accessibilityState={{ disabled: isProcessing }}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-done" size={19} color={Colors.primary} />
              <Text style={styles.takeAllButtonText}>Mark all {pendingDoses.length} doses as taken</Text>
            </TouchableOpacity>
          )}

          <View style={[styles.nextCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
            <View style={styles.nextIconBox}>
              <Ionicons name="document-text-outline" size={24} color={Colors.primary} />
            </View>
            <View style={styles.nextCopy}>
              <Text style={[styles.nextTitle, { color: themeColors.textSecondary }]}>Next reminder</Text>
              <Text style={[styles.nextSubtitle, { color: themeColors.textSecondary }]} numberOfLines={1}>
                {nextDose ? `${nextDose.medicineName} · ${nextDose.doseTime || 'Scheduled'}` : 'Your saved schedule'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={21} color={themeColors.textSecondary} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxxl,
  },
  header: {
    width: '100%',
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  brandLockup: { alignItems: 'center', gap: 9 },
  brandIcon: {
    width: 66,
    height: 66,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    ...Shadows.floating,
  },
  brandName: { fontSize: 17, fontWeight: '500', letterSpacing: 0.1 },
  closeButton: {
    position: 'absolute',
    top: 1,
    right: 0,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeHero: {
    width: '100%',
    minHeight: 232,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  timeHaloLarge: {
    position: 'absolute',
    width: 510,
    height: 510,
    borderRadius: 255,
    borderWidth: 1,
    opacity: 0.55,
    top: -116,
  },
  timeHaloSmall: {
    position: 'absolute',
    width: 390,
    height: 390,
    borderRadius: 195,
    borderWidth: 1,
    opacity: 0.45,
    top: -54,
  },
  screenTitle: { fontSize: 27, fontWeight: '500', lineHeight: 34, marginBottom: 17 },
  scheduledTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 13 },
  scheduledTime: { fontSize: 79, fontWeight: '800', letterSpacing: -3, fontVariant: ['tabular-nums'], lineHeight: 88 },
  timeMarks: { alignItems: 'center', justifyContent: 'space-between', height: 74, width: 24 },
  timeMarksRight: { transform: [{ scaleX: -1 }] },
  timeMarkDiagonal: { width: 24, height: 6, borderRadius: 3, backgroundColor: Colors.primary, transform: [{ rotate: '35deg' }] },
  timeMarkHorizontal: { width: 27, height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  timeSubtitle: { fontSize: 22, fontWeight: '500', marginTop: 12 },
  simultaneousSection: { width: '100%', marginBottom: Spacing.md, alignItems: 'center' },
  simultaneousHeaderText: { fontSize: 12, fontWeight: '600', marginBottom: 7 },
  dosePillRow: { gap: 8, paddingHorizontal: 2, paddingVertical: 2 },
  dosePill: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, borderRadius: Radius.pill, borderWidth: 1 },
  dosePillText: { fontSize: 13, fontWeight: '600', maxWidth: 150 },
  medicineCard: { width: '100%', borderRadius: 28, borderWidth: 1, padding: Spacing.xl, ...Shadows.card },
  medicineHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 86 },
  medicineIconBox: { width: 84, height: 84, borderRadius: 22, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  pillIcon: { transform: [{ rotate: '-45deg' }] },
  medicineHeading: { flex: 1, marginLeft: Spacing.lg, paddingRight: Spacing.sm },
  medicineName: { fontSize: 27, fontWeight: '800', lineHeight: 32 },
  medicineAmount: { fontSize: 18, fontWeight: '500', marginTop: 5 },
  doseLabelBadge: { backgroundColor: Colors.primaryLight, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 10, maxWidth: 112 },
  doseLabelText: { color: Colors.primary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  detailsPanel: { borderRadius: 22, paddingHorizontal: Spacing.lg, paddingVertical: 8, marginTop: Spacing.xl },
  detailRow: { minHeight: 74, flexDirection: 'row', alignItems: 'center' },
  detailIconBox: { width: 42, alignItems: 'flex-start', justifyContent: 'center' },
  detailCopy: { flex: 1 },
  detailTitle: { fontSize: 16, fontWeight: '500', lineHeight: 22 },
  detailSubtitle: { fontSize: 14, lineHeight: 20, marginTop: 2 },
  detailDivider: { height: 1, marginLeft: 42 },
  feedbackBanner: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 20, paddingHorizontal: Spacing.lg, paddingVertical: 14, marginTop: Spacing.md },
  feedbackText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  completedBanner: { backgroundColor: Colors.successLight },
  completedText: { flex: 1, color: Colors.successDark, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  errorBanner: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: Colors.errorLight, borderRadius: 16, padding: Spacing.md, marginTop: Spacing.md },
  errorText: { flex: 1, color: Colors.errorDark, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  encouragement: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 22, paddingHorizontal: Spacing.xl, paddingVertical: 17, marginTop: Spacing.xl },
  encouragementText: { flex: 1, fontSize: 16, lineHeight: 23, fontWeight: '500' },
  actionsRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 27 },
  secondaryAction: { flex: 1, alignItems: 'center', minWidth: 84 },
  secondaryActionCircle: { width: 94, height: 94, borderRadius: 47, alignItems: 'center', justifyContent: 'center', ...Shadows.card },
  skipCircle: { shadowOpacity: 0.02 },
  actionTitle: { fontSize: 17, fontWeight: '700', marginTop: 13 },
  actionSubtitle: { fontSize: 14, marginTop: 3 },
  primaryAction: { alignItems: 'center', flex: 1.3, minWidth: 118 },
  primaryActionRing: { width: 130, height: 130, borderRadius: 65, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  primaryActionCircle: { width: 104, height: 104, borderRadius: 52, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', ...Shadows.floating, elevation: 6 },
  primaryActionTitle: { fontSize: 18, fontWeight: '800', marginTop: 13, textAlign: 'center' },
  takeAllButton: { width: '100%', minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: Radius.pill, borderWidth: 1, borderColor: Colors.alarmBorder, backgroundColor: Colors.primaryLight, marginTop: Spacing.xl },
  takeAllButtonText: { color: Colors.primaryDark, fontSize: 13, fontWeight: '700' },
  nextCard: { width: '100%', minHeight: 76, flexDirection: 'row', alignItems: 'center', borderRadius: 24, borderWidth: 1, paddingHorizontal: Spacing.lg, marginTop: Spacing.xxl, ...Shadows.subtle },
  nextIconBox: { width: 42, height: 42, borderRadius: 14, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  nextCopy: { flex: 1, marginLeft: Spacing.md },
  nextTitle: { fontSize: 14, fontWeight: '600' },
  nextSubtitle: { fontSize: 15, marginTop: 3 },
});
