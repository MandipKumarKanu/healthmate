import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  Pressable,
  Platform,
  Dimensions,
  Keyboard,
} from 'react-native';
import { AppAlert as Alert } from '../../services/appAlert';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { AppScreen } from '../../components/ui/AppScreen';
import { AppHeader } from '../../components/ui/AppHeader';
import { AppCard } from '../../components/ui/AppCard';
import { AppButton } from '../../components/ui/AppButton';
import { MedicineIcon } from '../../components/ui/MedicineIcon';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { medicineRepository } from '../../database/repositories/medicineRepository';
import { scheduleRepository } from '../../database/repositories/scheduleRepository';
import { getTodayDateString } from '../../database/seed';
import { useReminderStore } from '../../store/reminderStore';
import { useAppStore } from '../../store/appStore';
import { notificationService } from '../../services/notificationService';
import { Medicine, RecurrenceType, ReminderTime } from '../../types';
import {
  validateDoseAmount,
  validateReminderTimes,
  isDuplicateReminderTime,
  formatTime12Hour,
  getTimeLabel,
  getNextDefaultReminderSlot,
} from '../../utils/reminderValidation';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import {
  RecurrenceScheduleModal,
  formatFriendlyDate,
} from '../../components/reminders/RecurrenceScheduleModal';
import { parseDateParts } from '../../utils/scheduleRecurrence';

const TIME_WHEEL_ITEM_HEIGHT = 48;
const TIME_WHEEL_VIEW_HEIGHT = 144;
const TIME_WHEEL_PADDING = TIME_WHEEL_VIEW_HEIGHT / 2;
const TIME_WHEEL_FIRST_SNAP_OFFSET =
  TIME_WHEEL_PADDING + TIME_WHEEL_ITEM_HEIGHT / 2 - TIME_WHEEL_VIEW_HEIGHT / 2;
const HOUR_WHEEL_SNAP_OFFSETS = Array.from(
  { length: 12 },
  (_, index) => TIME_WHEEL_FIRST_SNAP_OFFSET + index * TIME_WHEEL_ITEM_HEIGHT,
);
const MINUTE_WHEEL_SNAP_OFFSETS = Array.from(
  { length: 60 },
  (_, index) => TIME_WHEEL_FIRST_SNAP_OFFSET + index * TIME_WHEEL_ITEM_HEIGHT,
);

const PRESET_DOSES = [
  { label: 'Morning', time: '08:00', icon: 'sunny', color: '#D97706', bg: '#FEF3C7' },
  { label: 'Afternoon', time: '14:00', icon: 'partly-sunny', color: '#0284C7', bg: '#E0F2FE' },
  { label: 'Evening', time: '18:00', icon: 'cloudy-night', color: '#7C3AED', bg: '#EDE9FE' },
  { label: 'Night', time: '22:00', icon: 'moon', color: '#4338CA', bg: '#E0E7FF' },
] as const;

function getTimeIconInfo(time: string) {
  if (time < '11:00') {
    return {
      icon: 'sunny',
      label: 'Morning',
      color: '#D97706',
      bg: '#FEF3C7',
    };
  }
  if (time < '17:00') {
    return {
      icon: 'partly-sunny',
      label: 'Afternoon',
      color: '#0284C7',
      bg: '#E0F2FE',
    };
  }
  if (time < '21:00') {
    return {
      icon: 'cloudy-night',
      label: 'Evening',
      color: '#7C3AED',
      bg: '#EDE9FE',
    };
  }
  return {
    icon: 'moon',
    label: 'Night',
    color: '#4338CA',
    bg: '#E0E7FF',
  };
}

export default function SetReminderScreen() {
  const router = useRouter();
  const { keyboardHeight, isKeyboardVisible } = useKeyboardHeight();
  const SCREEN_HEIGHT = Dimensions.get('window').height;
  const { medicineId, scheduleId: routeScheduleId, date } = useLocalSearchParams<{
    medicineId?: string;
    scheduleId?: string;
    date?: string;
  }>();
  const { saveSchedule } = useReminderStore();
  const selectedDate = useAppStore((state) => state.selectedDate);

  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [selectedMed, setSelectedMed] = useState<Medicine | null>(null);
  const [isMedModalVisible, setIsMedModalVisible] = useState(false);
  const [modalSearch, setModalSearch] = useState('');
  const [recurrence, setRecurrence] = useState<RecurrenceType>('daily');
  const [startDate, setStartDate] = useState<string>(
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= getTodayDateString()
      ? date
      : getTodayDateString(),
  );
  const [endDate, setEndDate] = useState<string | undefined>(undefined);
  const [daysOfWeek, setDaysOfWeek] = useState<number[] | undefined>(undefined);
  const [isScheduleModalVisible, setIsScheduleModalVisible] = useState(false);
  const [times, setTimes] = useState<ReminderTime[]>([
    { id: 't_1', time: '08:00', amount: '1 tablet', label: 'Morning' },
  ]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [amount, setAmount] = useState('1 tablet');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | undefined>(routeScheduleId);
  const userHasCustomizedTimesRef = useRef(false);

  const selectedMedId = selectedMed?.id;

  // Other active schedules for the selected medicine (to prevent duplicate times)
  const otherSchedules = useMemo(() => {
    if (!selectedMedId) return [];
    return scheduleRepository
      .getAllByMedicineId(selectedMedId)
      .filter((s) => s.id !== editingScheduleId && s.enabled);
  }, [selectedMedId, editingScheduleId]);

  const otherScheduledTimes = useMemo(() => {
    const set = new Set<string>();
    otherSchedules.forEach((s) => {
      s.times.forEach((t) => set.add(t.time));
    });
    return set;
  }, [otherSchedules]);

  const otherTimesKey = useMemo(
    () => Array.from(otherScheduledTimes).sort().join(','),
    [otherScheduledTimes],
  );

  // When creating a new reminder, select default time following strict sequential priority:
  // 1. Morning (08:00)
  // 2. Afternoon (14:00 / 2:00 PM) if Morning is already scheduled
  // 3. Evening (18:00 / 6:00 PM) if Afternoon is already scheduled
  // 4. Night (22:00 / 10:00 PM) if Evening is already scheduled
  // 5. Next available candidate hour if all 4 priority slots are already scheduled
  useEffect(() => {
    if (!routeScheduleId && selectedMedId) {
      setTimes((prevTimes) => {
        if (userHasCustomizedTimesRef.current) {
          if (prevTimes.length === 1 && otherScheduledTimes.has(prevTimes[0].time)) {
            const nextSlot = getNextDefaultReminderSlot(otherScheduledTimes);
            return [
              {
                id: prevTimes[0].id,
                time: nextSlot.time,
                amount: prevTimes[0].amount || amount || '1 tablet',
                label: nextSlot.label,
              },
            ];
          }
          return prevTimes;
        }

        const nextSlot = getNextDefaultReminderSlot(otherScheduledTimes);
        return [
          {
            id: 't_1',
            time: nextSlot.time,
            amount: amount || '1 tablet',
            label: nextSlot.label,
          },
        ];
      });
    }
  }, [selectedMedId, routeScheduleId, otherTimesKey, otherScheduledTimes, amount]);

  // Time picker state and snap wheels for quick, precise minute selection.
  const [pickerTarget, setPickerTarget] = useState<{ id: string | 'new'; date: Date } | null>(null);
  const [tempPickerDate, setTempPickerDate] = useState<Date>(new Date());
  const hourWheelRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const minuteWheelRef = useRef<React.ElementRef<typeof ScrollView>>(null);

  useEffect(() => {
    if (!pickerTarget) return;
    const hourIndex = (pickerTarget.date.getHours() % 12 || 12) - 1;
    const minuteIndex = pickerTarget.date.getMinutes();
    requestAnimationFrame(() => {
      hourWheelRef.current?.scrollTo({
        y: TIME_WHEEL_FIRST_SNAP_OFFSET + hourIndex * TIME_WHEEL_ITEM_HEIGHT,
        animated: false,
      });
      minuteWheelRef.current?.scrollTo({
        y: TIME_WHEEL_FIRST_SNAP_OFFSET + minuteIndex * TIME_WHEEL_ITEM_HEIGHT,
        animated: false,
      });
    });
  }, [pickerTarget]);

  const loadMedicines = useCallback(() => {
    try {
      const list = medicineRepository.getAll();
      setMedicines(list);
      return list;
    } catch (e) {
      console.warn('Failed to load medicines:', e);
      return [];
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const list = loadMedicines();
      if (medicineId) {
        setSelectedMed((current) => {
          if (current?.id === medicineId) return current;
          const match = list.find((m) => m.id === medicineId);
          return match || current;
        });
      } else {
        setSelectedMed((current) => {
          if (current) return current;
          return list.length > 0 ? list[0] : null;
        });
      }
    }, [loadMedicines, medicineId]),
  );

  useEffect(() => {
    if (routeScheduleId && editingScheduleId !== routeScheduleId) {
      const existingSched = scheduleRepository.getById(routeScheduleId);
      if (existingSched) {
        setEditingScheduleId(existingSched.id);
        setRecurrence(existingSched.recurrence);
        setDaysOfWeek(existingSched.daysOfWeek);
        setStartDate(existingSched.startDate);
        setEndDate(existingSched.endDate);
        setTimes(
          existingSched.times.map((t) => ({
            ...t,
            label: t.label || getTimeLabel(t.time),
          })),
        );
        if (existingSched.times.length > 0 && existingSched.times[0].amount) {
          setAmount(existingSched.times[0].amount);
        }
        setNotificationsEnabled(true);
        if (existingSched.medicineId) {
          const med = medicineRepository.getById(existingSched.medicineId);
          if (med) {
            setSelectedMed((curr) => (curr?.id === med.id ? curr : med));
          }
        }
      }
    }
  }, [routeScheduleId, editingScheduleId]);

  const getNextSuggestedTime = (): string => {
    const commonPresets = ['08:00', '14:00', '18:00', '22:00'];
    const currentTimes = new Set(times.map((t) => t.time));
    const available = commonPresets.find(
      (p) => !currentTimes.has(p) && !otherScheduledTimes.has(p),
    );
    if (available) return available;
    const now = new Date();
    for (let offset = 1; offset <= 24; offset++) {
      const candidateHour = (now.getHours() + offset) % 24;
      const candidateTime = `${String(candidateHour).padStart(2, '0')}:00`;
      if (!currentTimes.has(candidateTime) && !otherScheduledTimes.has(candidateTime)) {
        return candidateTime;
      }
    }
    return '09:00';
  };

  const handleTimeSelected = (targetId: string | 'new', selectedTime: string) => {
    userHasCustomizedTimesRef.current = true;
    const isDuplicate = isDuplicateReminderTime(
      times,
      selectedTime,
      targetId === 'new' ? undefined : targetId,
    );

    if (isDuplicate) {
      Alert.alert(
        'Duplicate Reminder Time',
        `A dose is already scheduled for ${formatTime12Hour(selectedTime)}. Each dose reminder must have a distinct time.`,
      );
      return;
    }

    if (otherScheduledTimes.has(selectedTime)) {
      Alert.alert(
        'Reminder Already Exists',
        `${selectedMed?.name || 'This medicine'} already has an active reminder scheduled for ${formatTime12Hour(selectedTime)}. You cannot schedule the same medicine at the same time.`,
      );
      return;
    }

    if (targetId === 'new') {
      const newEntry: ReminderTime = {
        id: `t_${Date.now()}`,
        time: selectedTime,
        amount: amount.trim() || '1 tablet',
        label: getTimeLabel(selectedTime),
      };
      setTimes((prev) => [...prev, newEntry].sort((a, b) => a.time.localeCompare(b.time)));
    } else {
      setTimes((prev) =>
        prev
          .map((item) => {
            if (item.id !== targetId) return item;
            const isDefaultLabel =
              !item.label || ['Morning', 'Afternoon', 'Evening', 'Night'].includes(item.label);
            return {
              ...item,
              time: selectedTime,
              label: isDefaultLabel ? getTimeLabel(selectedTime) : item.label,
            };
          })
          .sort((a, b) => a.time.localeCompare(b.time)),
      );
    }
  };

  const openTimePicker = (targetId: string | 'new', initialTimeStr: string = '08:00') => {
    const parts = initialTimeStr.split(':').map(Number);
    const dateObj = new Date();
    dateObj.setHours(
      Number.isFinite(parts[0]) ? parts[0] : 8,
      Number.isFinite(parts[1]) ? parts[1] : 0,
      0,
      0,
    );

    setTempPickerDate(dateObj);
    setPickerTarget({ id: targetId, date: dateObj });
  };

  const confirmPickerModal = () => {
    if (!pickerTarget) return;
    const hours = String(tempPickerDate.getHours()).padStart(2, '0');
    const minutes = String(tempPickerDate.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;
    const targetId = pickerTarget.id;
    setPickerTarget(null);
    handleTimeSelected(targetId, timeStr);
  };

  const closePickerModal = () => {
    setPickerTarget(null);
  };

  const handleTimeWheelScroll = (unit: 'hour' | 'minute', offsetY: number) => {
    const count = unit === 'hour' ? 12 : 60;
    const index = Math.max(
      0,
      Math.min(
        count - 1,
        Math.round((offsetY - TIME_WHEEL_FIRST_SNAP_OFFSET) / TIME_WHEEL_ITEM_HEIGHT),
      ),
    );

    setTempPickerDate((current) => {
      const next = new Date(current);
      if (unit === 'hour') {
        const hour12 = index + 1;
        const isPM = current.getHours() >= 12;
        next.setHours((hour12 % 12) + (isPM ? 12 : 0));
      } else {
        next.setMinutes(index);
      }
      return next;
    });
  };

  const setPickerPeriod = (period: 'AM' | 'PM') => {
    setTempPickerDate((current) => {
      const next = new Date(current);
      const hour = next.getHours();
      if (period === 'AM' && hour >= 12) next.setHours(hour - 12);
      if (period === 'PM' && hour < 12) next.setHours(hour + 12);
      return next;
    });
  };

  const togglePresetTime = (presetTime: string, label: string) => {
    userHasCustomizedTimesRef.current = true;
    const existing = times.find((t) => t.time === presetTime);
    if (existing) {
      if (times.length <= 1) {
        // Tapping the active sole preset opens the custom time picker directly
        openTimePicker(existing.id, existing.time);
        return;
      }
      removeTime(existing.id);
    } else {
      if (otherScheduledTimes.has(presetTime)) {
        Alert.alert(
          'Reminder Already Exists',
          `${selectedMed?.name || 'This medicine'} already has an active reminder scheduled for ${formatTime12Hour(presetTime)}. You cannot schedule the same medicine at the same time.`,
        );
        return;
      }

      const newEntry: ReminderTime = {
        id: `t_${Date.now()}_${presetTime.replace(':', '')}`,
        time: presetTime,
        amount: amount.trim() || '1 tablet',
        label,
      };
      setTimes((prev) => [...prev, newEntry].sort((a, b) => a.time.localeCompare(b.time)));
    }
  };

  const addPresetTime = (presetTime: string) => {
    userHasCustomizedTimesRef.current = true;
    if (isDuplicateReminderTime(times, presetTime)) {
      Alert.alert(
        'Duplicate Reminder Time',
        `A dose is already scheduled for ${formatTime12Hour(presetTime)}.`,
      );
      return;
    }
    if (otherScheduledTimes.has(presetTime)) {
      Alert.alert(
        'Reminder Already Exists',
        `${selectedMed?.name || 'This medicine'} already has an active reminder scheduled for ${formatTime12Hour(presetTime)}. You cannot schedule the same medicine at the same time.`,
      );
      return;
    }
    const newEntry: ReminderTime = {
      id: `t_${Date.now()}`,
      time: presetTime,
      amount: amount.trim() || '1 tablet',
      label: getTimeLabel(presetTime),
    };
    setTimes((prev) => [...prev, newEntry].sort((a, b) => a.time.localeCompare(b.time)));
  };

  const removeTime = (id: string) => {
    userHasCustomizedTimesRef.current = true;
    if (times.length <= 1) {
      Alert.alert('Notice', 'At least one reminder time is required.');
      return;
    }
    setTimes(times.filter((t) => t.id !== id));
  };

  const handleGlobalAmountChange = (val: string) => {
    setAmount(val);
    const validation = validateDoseAmount(val);
    if (!validation.valid) {
      setAmountError(validation.error || 'Invalid dose amount');
    } else {
      setAmountError(null);
    }
    setTimes((prev) => prev.map((t) => ({ ...t, amount: val })));
  };

  const handleDoseAmountChange = (id: string, val: string) => {
    setTimes((prev) => prev.map((t) => (t.id === id ? { ...t, amount: val } : t)));
  };

  const handleSave = async () => {
    if (isSaving) return;

    if (!selectedMed) {
      Alert.alert('Error', 'Please select a medicine first.');
      return;
    }

    const amountValidation = validateDoseAmount(amount);
    if (!amountValidation.valid) {
      setAmountError(amountValidation.error || 'Invalid dose amount');
      Alert.alert('Invalid Dose Amount', amountValidation.error);
      return;
    }

    const timesValidation = validateReminderTimes(times);
    if (!timesValidation.valid) {
      Alert.alert('Schedule Validation Error', timesValidation.error);
      return;
    }

    for (const dose of times) {
      if (otherScheduledTimes.has(dose.time)) {
        Alert.alert(
          'Duplicate Reminder Time',
          `${selectedMed.name} already has an active reminder scheduled for ${formatTime12Hour(dose.time)}. You cannot schedule the same medicine at the same time.`,
        );
        return;
      }
    }

    setIsSaving(true);
    try {
      let canNotify = notificationsEnabled;
      if (notificationsEnabled) {
        canNotify = await notificationService.requestPermissions();
        if (!canNotify) {
          Alert.alert(
            'Notifications are disabled',
            'The schedule can be saved, but alarm-style reminders will not alert you until you allow notifications in system settings.',
          );
        }
      }

      // Use the date visible in the calendar when the route did not supply one.
      // This keeps the in-memory reminder list in sync with the saved SQLite row.
      const refreshDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : selectedDate;
      const existingSchedule = editingScheduleId
        ? scheduleRepository.getById(editingScheduleId)
        : null;
      const scheduleId = editingScheduleId || `sched_${selectedMed.id}_${Date.now()}`;
      const now = new Date().toISOString();

      const saveResult = await saveSchedule(
        {
          id: scheduleId,
          medicineId: selectedMed.id,
          recurrence,
          daysOfWeek,
          startDate,
          endDate,
          times,
          enabled: true,
          notificationsEnabled: canNotify,
          createdAt: existingSchedule?.createdAt ?? now,
          updatedAt: now,
        },
        refreshDate,
      );

      if (!saveResult.saved) {
        Alert.alert(
          'Could not save schedule',
          'HealthMate could not finish saving this schedule to your device database. Please try again; if it keeps failing, check that enough free storage is available.',
        );
        return;
      }

      // Each alarm-arming failure has a named, distinct reason so
      // the user knows exactly which setting to fix (no more generic copy).
      if (saveResult.alarmFailure) {
        const failureMessages: Record<string, string> = {
          notification_permission:
            'Your schedule is saved, but notification permission is currently denied. Allow HealthMate to send notifications in Android Settings → Apps → HealthMate → Notifications, then edit and re-save this schedule to arm reminders.',
          exact_alarm:
            'Your schedule is saved, but exact alarm access was not granted. HealthMate cannot arm reliable alarm reminders until you allow “Alarms & reminders” in Android Settings → Apps → HealthMate → Alarms & reminders.',
          full_screen_intent:
            'Your schedule is saved, but Android is blocking full-screen alarm screens. Allow HealthMate to use full-screen notifications in Android Settings, then edit and re-save this schedule so the alarm screen can open automatically.',
          internal:
            'Your schedule is saved, but at least one alarm could not be scheduled (internal or network error). Try re-saving this schedule; if it keeps failing, check your connection and device storage.',
        };
        Alert.alert('Schedule saved without exact alarms', failureMessages[saveResult.alarmFailure], [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }

      Alert.alert(
        'Success',
        canNotify
          ? 'Medication schedule saved and alarm reminders scheduled.'
          : 'Medication schedule saved. Alarm reminders are OFF until you grant notification and exact-alarm access.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      console.warn('Could not save medication schedule:', error);
      Alert.alert(
        'Could not save schedule',
        'HealthMate could not finish saving this reminder. Please retry, then check the Reminders page before submitting it again.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const recurrenceOptions: Array<{ type: RecurrenceType; label: string }> = [
    { type: 'daily', label: 'Every Day' },
    { type: 'weekly', label: 'Every Week' },
    { type: 'monthly', label: 'Every Month' },
    { type: 'custom', label: 'Custom' },
    { type: 'once', label: 'Once' },
  ];

  const filteredMedicines = medicines.filter((m) =>
    `${m.name} ${m.strength} ${m.category || ''}`
      .toLowerCase()
      .includes(modalSearch.trim().toLowerCase()),
  );

  return (
    <AppScreen scrollable contentContainerStyle={styles.scrollContent}>
      <AppHeader
        title="Set Reminder"
        subtitle="Configure your medication schedule"
        brandText="HealthMate AI"
        onBackPress={() => router.back()}
      />

      <View style={styles.body}>
        {/* Medicine Selector Card */}
        <SectionHeader title="Selected Medicine" />
        <AppCard style={styles.card}>
          {selectedMed ? (
            <View style={styles.selectedMedContainer}>
              <View style={styles.medRow}>
                <MedicineIcon form={selectedMed.dosageForm} name={selectedMed.name} size={46} />
                <View style={styles.medInfo}>
                  <Text style={styles.medName}>{selectedMed.name}</Text>
                  <Text style={styles.medSub}>
                    {selectedMed.strength} · {selectedMed.dosageForm}
                    {selectedMed.category ? ` · ${selectedMed.category}` : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.changeMedButton}
                  onPress={() => setIsMedModalVisible(true)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Change selected medicine"
                >
                  <Feather name="edit-2" size={14} color={Colors.primary} />
                  <Text style={styles.changeMedText}>Change</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.emptySelectedMed}>
              <Ionicons name="medkit-outline" size={32} color="#94A3B8" />
              <Text style={styles.noMedText}>No medicine selected</Text>
              <TouchableOpacity
                style={styles.selectMedButton}
                onPress={() => setIsMedModalVisible(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Select a medicine from list"
              >
                <Ionicons name="add" size={18} color="#FFFFFF" />
                <Text style={styles.selectMedButtonText}>Select Medicine</Text>
              </TouchableOpacity>
            </View>
          )}
        </AppCard>

        {/* Recurrence Option */}
        <SectionHeader title="Repeat Schedule" />
        <View style={styles.recurrenceContainer}>
          {recurrenceOptions.map((opt) => (
            <TouchableOpacity
              key={opt.type}
              style={[
                styles.recurrenceButton,
                recurrence === opt.type && styles.recurrenceButtonActive,
              ]}
              onPress={() => {
                setRecurrence(opt.type);
                if (opt.type === 'weekly' || opt.type === 'monthly' || opt.type === 'custom') {
                  setIsScheduleModalVisible(true);
                }
              }}
            >
              <Text
                style={[
                  styles.recurrenceText,
                  recurrence === opt.type && styles.recurrenceTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Active Schedule Details Card */}
        <TouchableOpacity
          style={styles.scheduleDetailsCard}
          onPress={() => setIsScheduleModalVisible(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Open schedule details and calendar"
        >
          <View style={styles.scheduleDetailsIcon}>
            <Ionicons name="calendar" size={18} color={Colors.primary} />
          </View>
          <View style={styles.scheduleDetailsInfo}>
            <Text style={styles.scheduleDetailsTitle}>
              {recurrence === 'daily'
                ? 'Repeats Every Day'
                : recurrence === 'weekly'
                  ? `Every Week · ${formatFriendlyDate(startDate).split(',')[0]}`
                  : recurrence === 'monthly'
                    ? `Every Month · Day ${parseDateParts(startDate)?.[2] || ''}`
                    : recurrence === 'custom'
                      ? daysOfWeek && daysOfWeek.length > 0
                        ? `Custom · ${daysOfWeek.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`
                        : 'Custom Days'
                      : 'Single Dose (Once)'}
            </Text>
            <Text style={styles.scheduleDetailsSub}>
              Starts {formatFriendlyDate(startDate)}
              {endDate ? ` · Ends ${formatFriendlyDate(endDate)}` : ' · Ongoing'}
            </Text>
          </View>
          <View style={styles.scheduleChangePill}>
            <Text style={styles.scheduleChangePillText}>Calendar</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
          </View>
        </TouchableOpacity>

        {/* Reminder Times Section */}
        <View style={styles.reminderHeading}>
          <SectionHeader title="Reminder Times" />
          <View style={styles.doseCountBadge}>
            <Text style={styles.doseCountBadgeText}>
              {times.length} {times.length === 1 ? 'dose' : 'doses'}/day
            </Text>
          </View>
        </View>

        <AppCard style={styles.card}>
          {/* Active dose times list */}
          {times.map((t) => {
            const meta = getTimeIconInfo(t.time);
            const displayLabel = t.label || meta.label;
            const isOnlyOne = times.length <= 1;

            return (
              <View key={t.id} style={styles.timeRowCard}>
                <TouchableOpacity
                  style={styles.timeRowMainTouch}
                  onPress={() => openTimePicker(t.id, t.time)}
                  accessibilityRole="button"
                  accessibilityLabel={`Change time for ${displayLabel}, currently ${formatTime12Hour(t.time)}`}
                  accessibilityHint="Tap to set custom time"
                  activeOpacity={0.7}
                >
                  <View style={[styles.timeRowIconBadge, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon as any} size={18} color={meta.color} />
                  </View>

                  <View style={styles.timeRowInfo}>
                    <Text style={styles.timeRowLabel}>{displayLabel}</Text>
                    <Text style={styles.timeRowAmount}>{t.amount || amount || '1 tablet'}</Text>
                  </View>

                  <View style={styles.timeRowPill}>
                    <Feather name="clock" size={13} color={Colors.primary} style={{ marginRight: 6 }} />
                    <Text style={styles.timeRowPillText}>{formatTime12Hour(t.time)}</Text>
                    <Feather name="chevron-down" size={13} color={Colors.primary} style={{ marginLeft: 4 }} />
                  </View>
                </TouchableOpacity>

                {!isOnlyOne && (
                  <TouchableOpacity
                    style={styles.timeRowDeleteBtn}
                    onPress={() => removeTime(t.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${displayLabel} reminder time`}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="trash-outline" size={17} color={Colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {/* Quick Presets & Add Section */}
          <View style={styles.quickPresetsSection}>
            <Text style={styles.quickPresetsTitle}>Quick Add / Toggle Doses</Text>
            <View style={styles.presetGrid}>
              {PRESET_DOSES.map((preset) => {
                const isAdded = times.some((t) => t.time === preset.time);
                const isTaken = otherScheduledTimes.has(preset.time);
                return (
                  <TouchableOpacity
                    key={preset.time}
                    style={[
                      styles.presetCard,
                      isAdded && styles.presetCardActive,
                      isTaken && styles.presetCardTaken,
                    ]}
                    onPress={() => togglePresetTime(preset.time, preset.label)}
                    accessibilityRole="button"
                    accessibilityLabel={`${isAdded ? 'Remove' : isTaken ? 'Already scheduled' : 'Add'} ${preset.label} preset at ${formatTime12Hour(preset.time)}`}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.presetIconCircle,
                        {
                          backgroundColor: isAdded
                            ? Colors.primaryLight
                            : isTaken
                              ? '#E2E8F0'
                              : preset.bg,
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          isAdded
                            ? 'checkmark'
                            : isTaken
                              ? 'lock-closed'
                              : (preset.icon as any)
                        }
                        size={14}
                        color={
                          isAdded
                            ? Colors.primary
                            : isTaken
                              ? Colors.textSecondary
                              : preset.color
                        }
                      />
                    </View>
                    <View style={styles.presetTextCol}>
                      <Text
                        style={[
                          styles.presetLabel,
                          isAdded && styles.presetLabelActive,
                          isTaken && styles.presetLabelTaken,
                        ]}
                      >
                        {preset.label}
                      </Text>
                      <Text
                        style={[
                          styles.presetTime,
                          isAdded && styles.presetTimeActive,
                          isTaken && styles.presetTimeTaken,
                        ]}
                      >
                        {isTaken ? 'Already set' : formatTime12Hour(preset.time)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Custom Time Picker Button */}
            <TouchableOpacity
              style={styles.addCustomTimeBtn}
              onPress={() => openTimePicker('new', getNextSuggestedTime())}
              accessibilityRole="button"
              accessibilityLabel="Pick custom reminder time"
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
              <Text style={styles.addCustomTimeText}>Pick Custom Time</Text>
            </TouchableOpacity>
          </View>
        </AppCard>

        {/* Dosage Amount */}
        <SectionHeader title="Dose Amount" />
        <AppCard style={styles.card}>
          <TextInput
            style={[styles.amountInput, amountError ? styles.inputError : null]}
            value={amount}
            onChangeText={handleGlobalAmountChange}
            placeholder="e.g. 1 tablet, 2 drops, 5 ml"
            placeholderTextColor="#64748B"
            accessibilityLabel="Default dose amount"
          />
          {amountError ? (
            <Text style={styles.fieldErrorText}>{amountError}</Text>
          ) : (
            <Text style={styles.amountHelperText}>
              Applied as the default amount for all scheduled dose times
            </Text>
          )}
        </AppCard>

        {/* Save Button */}
        <View style={styles.saveContainer}>
          <AppButton
            title={isSaving ? 'Saving schedule…' : 'Save Medication Schedule'}
            onPress={handleSave}
            variant="primary"
            size="lg"
            loading={isSaving}
            disabled={isSaving}
          />
        </View>
      </View>

      {/* HealthMate-styled time picker. Avoids the platform-native Android dialog. */}
      {pickerTarget && (
        <Modal
          transparent
          animationType="fade"
          visible
          statusBarTranslucent
          onRequestClose={closePickerModal}
        >
          <View style={styles.modalBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closePickerModal}
              accessibilityRole="button"
              accessibilityLabel="Close time picker"
            />
            <View style={styles.timePickerCard}>
              <View style={styles.timePickerHeader}>
                <View style={styles.timePickerIcon}>
                  <Ionicons name="time-outline" size={21} color={Colors.primary} />
                </View>
                <View style={styles.timePickerHeading}>
                  <Text style={styles.timePickerTitle}>Choose reminder time</Text>
                  <Text style={styles.timePickerSubtitle}>
                    Set when HealthMate should remind you
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={closePickerModal}
                  style={styles.timePickerClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close time picker"
                >
                  <Ionicons name="close" size={20} color={Colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.timePickerControls}>
                <View style={styles.timePickerColumn}>
                  <View style={styles.timeWheelViewport}>
                    <ScrollView
                      ref={hourWheelRef}
                      style={styles.timeWheelScroll}
                      contentContainerStyle={styles.timeWheelContent}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                      snapToOffsets={HOUR_WHEEL_SNAP_OFFSETS}
                      snapToStart={false}
                      snapToEnd={false}
                      decelerationRate="fast"
                      snapToAlignment="start"
                      onScrollEndDrag={(event) =>
                        handleTimeWheelScroll('hour', event.nativeEvent.contentOffset.y)
                      }
                      onMomentumScrollEnd={(event) =>
                        handleTimeWheelScroll('hour', event.nativeEvent.contentOffset.y)
                      }
                      accessibilityLabel="Scroll to select reminder hour"
                    >
                      {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => {
                        const selectedHour = tempPickerDate.getHours() % 12 || 12;
                        const selected = hour === selectedHour;
                        return (
                          <View key={hour} style={styles.timeWheelItem}>
                            <Text
                              style={[
                                styles.timeWheelItemText,
                                selected && styles.timeWheelItemTextSelected,
                              ]}
                            >
                              {String(hour).padStart(2, '0')}
                            </Text>
                          </View>
                        );
                      })}
                    </ScrollView>
                    <View pointerEvents="none" style={styles.timeWheelSelection} />
                  </View>
                </View>

                <Text style={styles.timePickerColon}>:</Text>

                <View style={styles.timePickerColumn}>
                  <View style={styles.timeWheelViewport}>
                    <ScrollView
                      ref={minuteWheelRef}
                      style={styles.timeWheelScroll}
                      contentContainerStyle={styles.timeWheelContent}
                      showsVerticalScrollIndicator={false}
                      nestedScrollEnabled
                      snapToOffsets={MINUTE_WHEEL_SNAP_OFFSETS}
                      snapToStart={false}
                      snapToEnd={false}
                      decelerationRate="fast"
                      snapToAlignment="start"
                      onScrollEndDrag={(event) =>
                        handleTimeWheelScroll('minute', event.nativeEvent.contentOffset.y)
                      }
                      onMomentumScrollEnd={(event) =>
                        handleTimeWheelScroll('minute', event.nativeEvent.contentOffset.y)
                      }
                      accessibilityLabel="Scroll to select reminder minute"
                    >
                      {Array.from({ length: 60 }, (_, minute) => minute).map((minute) => {
                        const selected = minute === tempPickerDate.getMinutes();
                        return (
                          <View key={minute} style={styles.timeWheelItem}>
                            <Text
                              style={[
                                styles.timeWheelItemText,
                                selected && styles.timeWheelItemTextSelected,
                              ]}
                            >
                              {String(minute).padStart(2, '0')}
                            </Text>
                          </View>
                        );
                      })}
                    </ScrollView>
                    <View pointerEvents="none" style={styles.timeWheelSelection} />
                  </View>
                </View>

                <View style={styles.timePickerPeriod}>
                  <TouchableOpacity
                    style={[
                      styles.timePickerPeriodOption,
                      tempPickerDate.getHours() < 12 && styles.timePickerPeriodOptionActive,
                    ]}
                    onPress={() => setPickerPeriod('AM')}
                    accessibilityRole="button"
                    accessibilityState={{ selected: tempPickerDate.getHours() < 12 }}
                  >
                    <Text
                      style={[
                        styles.timePickerPeriodText,
                        tempPickerDate.getHours() < 12 && styles.timePickerPeriodTextActive,
                      ]}
                    >
                      AM
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.timePickerPeriodOption,
                      tempPickerDate.getHours() >= 12 && styles.timePickerPeriodOptionActive,
                    ]}
                    onPress={() => setPickerPeriod('PM')}
                    accessibilityRole="button"
                    accessibilityState={{ selected: tempPickerDate.getHours() >= 12 }}
                  >
                    <Text
                      style={[
                        styles.timePickerPeriodText,
                        tempPickerDate.getHours() >= 12 && styles.timePickerPeriodTextActive,
                      ]}
                    >
                      PM
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.timePickerActions}>
                <TouchableOpacity
                  style={[styles.timePickerAction, styles.timePickerCancel]}
                  onPress={closePickerModal}
                  accessibilityRole="button"
                >
                  <Text style={styles.timePickerCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.timePickerAction, styles.timePickerConfirm]}
                  onPress={confirmPickerModal}
                  accessibilityRole="button"
                >
                  <Text style={styles.timePickerConfirmText}>Set time</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Medicine Selection Modal */}
      <Modal
        visible={isMedModalVisible}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setIsMedModalVisible(false)}
      >
        <View
          style={[
            styles.medModalOverlay,
            isKeyboardVisible && {
              justifyContent: 'flex-end',
              paddingBottom: keyboardHeight + 12,
              paddingTop: 36,
            },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              if (isKeyboardVisible) {
                Keyboard.dismiss();
              } else {
                setIsMedModalVisible(false);
              }
            }}
          />
          <View
            style={[
              styles.medModalContainer,
              isKeyboardVisible && {
                maxHeight: Math.max(340, SCREEN_HEIGHT - keyboardHeight - 56),
              },
            ]}
          >
              {/* Modal Header */}
              <View style={styles.medModalHeader}>
                <View>
                  <Text style={styles.medModalTitle}>Select Medicine</Text>
                  <Text style={styles.medModalSubtitle}>Choose which medication to schedule</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setIsMedModalVisible(false)}
                  style={styles.medModalCloseBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close selection dialog"
                >
                  <Ionicons name="close" size={22} color="#475569" />
                </TouchableOpacity>
              </View>

              {/* In-Dialog Search (if medicines exist) */}
              {medicines.length > 0 && (
                <View style={styles.medModalSearchBox}>
                  <Ionicons name="search" size={18} color="#94A3B8" style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.medModalSearchInput}
                    value={modalSearch}
                    onChangeText={setModalSearch}
                    placeholder="Search medicines..."
                    placeholderTextColor="#94A3B8"
                    accessibilityLabel="Search medicines in dialog"
                  />
                  {modalSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setModalSearch('')}>
                      <Ionicons name="close-circle" size={16} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Medicines List or Empty State */}
              {medicines.length === 0 ? (
                <View style={styles.medModalEmptyBox}>
                  <View style={styles.medModalEmptyIconWrap}>
                    <Ionicons name="medkit-outline" size={40} color="#94A3B8" />
                  </View>
                  <Text style={styles.medModalEmptyTitle}>No Medicines Added</Text>
                  <Text style={styles.medModalEmptySub}>
                    You must add a medicine to your cabinet before scheduling a reminder.
                  </Text>
                  <TouchableOpacity
                    style={styles.medModalAddBtn}
                    onPress={() => {
                      setIsMedModalVisible(false);
                      router.push('/medicines/add');
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="add" size={18} color="#FFFFFF" />
                    <Text style={styles.medModalAddBtnText}>Add Medicine</Text>
                  </TouchableOpacity>
                </View>
              ) : filteredMedicines.length === 0 ? (
                <View style={styles.medModalNoResults}>
                  <Text style={styles.medModalNoResultsText}>
                    No medicines match "{modalSearch}"
                  </Text>
                </View>
              ) : (
                <ScrollView
                  style={styles.medModalList}
                  contentContainerStyle={{ paddingBottom: 24 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                >
                  {filteredMedicines.map((med) => {
                    const isSelected = selectedMed?.id === med.id;
                    return (
                      <TouchableOpacity
                        key={med.id}
                        style={[styles.medModalItem, isSelected && styles.medModalItemActive]}
                        onPress={() => {
                          setSelectedMed(med);
                          setIsMedModalVisible(false);
                          setModalSearch('');

                          if (!routeScheduleId) {
                            const defaultDose =
                              med.dosageForm === 'syrup'
                                ? '5 ml'
                                : med.dosageForm === 'eye_drop'
                                  ? '2 drops'
                                  : med.dosageForm === 'cream'
                                    ? '1 application'
                                    : med.dosageForm === 'injection'
                                      ? '1 dose'
                                      : med.dosageForm === 'capsule'
                                        ? '1 capsule'
                                        : '1 tablet';
                            setAmount(defaultDose);
                            setTimes((prev) =>
                              prev.map((t) => ({
                                ...t,
                                amount: defaultDose,
                              })),
                            );
                          }
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={`${med.name}, ${med.strength}, ${med.dosageForm}`}
                      >
                        <MedicineIcon form={med.dosageForm} name={med.name} size={42} />
                        <View style={styles.medModalItemInfo}>
                          <Text style={styles.medModalItemName}>{med.name}</Text>
                          <Text style={styles.medModalItemSub}>
                            {med.strength} · {med.dosageForm}
                            {med.category ? ` · ${med.category}` : ''}
                          </Text>
                        </View>
                        {isSelected ? (
                          <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />
                        ) : (
                          <View style={styles.medModalRadioUnchecked} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
        </View>
      </Modal>

      {/* Recurrence Schedule Setup Modal */}
      <RecurrenceScheduleModal
        visible={isScheduleModalVisible}
        initialRecurrence={recurrence}
        initialStartDate={startDate}
        initialEndDate={endDate}
        initialDaysOfWeek={daysOfWeek}
        onClose={() => setIsScheduleModalVisible(false)}
        onApply={(config) => {
          setRecurrence(config.recurrence);
          setStartDate(config.startDate);
          setEndDate(config.endDate);
          setDaysOfWeek(config.daysOfWeek);
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: Spacing.xl,
  },
  body: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
  },
  card: {
    marginBottom: Spacing.lg,
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectedMedContainer: {
    paddingVertical: 2,
  },
  medInfo: {
    marginLeft: 12,
    flex: 1,
  },
  medName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  medSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  changeMedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    gap: 4,
  },
  changeMedText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  emptySelectedMed: {
    alignItems: 'center',
    paddingVertical: 18,
    gap: 8,
  },
  noMedText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  selectMedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    gap: 6,
    marginTop: 4,
  },
  selectMedButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  recurrenceContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: Spacing.md,
  },
  scheduleDetailsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: Spacing.lg,
    gap: 12,
  },
  scheduleDetailsIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleDetailsInfo: {
    flex: 1,
  },
  scheduleDetailsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  scheduleDetailsSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  scheduleChangePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    gap: 4,
  },
  scheduleChangePillText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  recurrenceButton: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.cardBackground,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recurrenceButtonActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  recurrenceText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  recurrenceTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  reminderHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  doseCountBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  doseCountBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  timeRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 8,
  },
  timeRowMainTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timeRowIconBadge: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeRowInfo: {
    flex: 1,
  },
  timeRowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  timeRowAmount: {
    fontSize: 13,
    color: Colors.textPrimary,
    marginTop: 2,
    fontWeight: '700',
  },
  timeRowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0EFF3',
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  timeRowPillText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  timeRowDeleteBtn: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    backgroundColor: '#FEECEE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickPresetsSection: {
    marginTop: 14,
  },
  quickPresetsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetCard: {
    width: '48.5%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  presetCardActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  presetCardTaken: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
    opacity: 0.8,
  },
  presetIconCircle: {
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetTextCol: {
    flex: 1,
  },
  presetLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  presetLabelActive: {
    color: Colors.primary,
  },
  presetLabelTaken: {
    color: Colors.textSecondary,
  },
  presetTime: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.textSecondary,
    marginTop: 1,
  },
  presetTimeActive: {
    color: Colors.primaryDark,
  },
  presetTimeTaken: {
    color: Colors.textTertiary,
    fontWeight: '600',
  },
  addCustomTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    borderStyle: 'dashed',
    paddingVertical: 11,
    marginTop: 10,
    gap: 6,
  },
  addCustomTimeText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
  },
  amountInput: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    paddingVertical: 6,
  },
  inputError: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.error,
  },
  fieldErrorText: {
    fontSize: 12,
    color: Colors.error,
    marginTop: 4,
  },
  amountHelperText: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  toggleSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  saveContainer: {
    marginTop: Spacing.sm,
    marginBottom: 0,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.60)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  timePickerCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  timePickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  timePickerIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePickerHeading: {
    flex: 1,
  },
  timePickerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  timePickerSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  timePickerClose: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePickerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  timePickerColumn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeWheelViewport: {
    width: 62,
    height: TIME_WHEEL_VIEW_HEIGHT,
    borderRadius: Radius.lg,
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  timeWheelScroll: {
    flex: 1,
  },
  timeWheelContent: {
    paddingVertical: TIME_WHEEL_PADDING,
  },
  timeWheelItem: {
    height: TIME_WHEEL_ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeWheelItemText: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '500',
    color: Colors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
  timeWheelItemTextSelected: {
    fontSize: 27,
    lineHeight: 34,
    fontWeight: '800',
    color: Colors.primary,
  },
  timeWheelSelection: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: TIME_WHEEL_ITEM_HEIGHT,
    height: TIME_WHEEL_ITEM_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
  },
  timePickerColon: {
    fontSize: 30,
    fontWeight: '700',
    color: Colors.textSecondary,
    paddingBottom: 2,
  },
  timePickerPeriod: {
    gap: Spacing.sm,
    marginLeft: Spacing.xs,
  },
  timePickerPeriodOption: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    minWidth: 54,
  },
  timePickerPeriodOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  timePickerPeriodText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  timePickerPeriodTextActive: {
    color: Colors.primary,
  },
  timePickerActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  timePickerAction: {
    flex: 1,
    minHeight: 46,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePickerCancel: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  timePickerConfirm: {
    backgroundColor: Colors.primary,
  },
  timePickerCancelText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  timePickerConfirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  modalContent: {
    backgroundColor: Colors.cardBackground,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingBottom: 34,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalHeaderBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  modalCancelText: {
    fontSize: 16,
    color: Colors.textSecondary,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  modalDoneText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
  pickerWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  medModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.60)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  medModalKeyboardContainer: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '100%',
    flexShrink: 1,
  },
  medModalContainer: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '90%',
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  medModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  medModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  medModalSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  medModalCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medModalSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: Radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  medModalSearchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.textPrimary,
    padding: 0,
  },
  medModalEmptyBox: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  medModalEmptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  medModalEmptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  medModalEmptySub: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
  },
  medModalAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    gap: 6,
  },
  medModalAddBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  medModalNoResults: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  medModalNoResultsText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  medModalList: {
    maxHeight: 380,
    flexGrow: 0,
  },
  medModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    marginBottom: 8,
    backgroundColor: '#FAFAFC',
  },
  medModalItemActive: {
    borderColor: Colors.primary,
    backgroundColor: '#EFF6FF',
  },
  medModalItemInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  medModalItemName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  medModalItemSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  medModalRadioUnchecked: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
});
