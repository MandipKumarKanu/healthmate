import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  Modal,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, Feather } from '@expo/vector-icons';
import DateTimePicker, {
  DateTimePickerAndroid,
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
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
import { notificationService } from '../../services/notificationService';
import { Medicine, RecurrenceType, ReminderTime } from '../../types';
import {
  validateDoseAmount,
  validateReminderTimes,
  isDuplicateReminderTime,
  formatTime12Hour,
  getTimeLabel,
} from '../../utils/reminderValidation';

export default function SetReminderScreen() {
  const router = useRouter();
  const { medicineId, date } = useLocalSearchParams<{ medicineId?: string; date?: string }>();
  const { saveSchedule } = useReminderStore();

  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [selectedMed, setSelectedMed] = useState<Medicine | null>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceType>('daily');
  const [times, setTimes] = useState<ReminderTime[]>([
    { id: 't_1', time: '08:00', amount: '1 tablet', label: 'Morning' },
  ]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [amount, setAmount] = useState('1 tablet');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [medicineSearch, setMedicineSearch] = useState('');
  const [editingTimes, setEditingTimes] = useState(true);

  // Time picker state for modal display (iOS, Web, or fallback)
  const [pickerTarget, setPickerTarget] = useState<{ id: string | 'new'; date: Date } | null>(null);
  const [tempPickerDate, setTempPickerDate] = useState<Date>(new Date());

  useEffect(() => {
    const list = medicineRepository.getAll();
    setMedicines(list);

    if (medicineId) {
      const match = list.find((m) => m.id === medicineId);
      if (match) setSelectedMed(match);
      const existingSched = scheduleRepository.getByMedicineId(medicineId);
      if (existingSched) {
        setRecurrence(existingSched.recurrence);
        setTimes(
          existingSched.times.map((t) => ({
            ...t,
            label: t.label || getTimeLabel(t.time),
          }))
        );
        if (existingSched.times.length > 0 && existingSched.times[0].amount) {
          setAmount(existingSched.times[0].amount);
        }
        setNotificationsEnabled(existingSched.notificationsEnabled);
      }
    } else if (list.length > 0) {
      setSelectedMed(list[0]);
    }
  }, [medicineId]);

  const getNextSuggestedTime = (): string => {
    const commonPresets = ['08:00', '12:00', '14:00', '18:00', '20:00', '22:00'];
    const available = commonPresets.find((p) => !times.some((t) => t.time === p));
    if (available) return available;
    const now = new Date();
    const nextHour = (now.getHours() + 1) % 24;
    return `${String(nextHour).padStart(2, '0')}:00`;
  };

  const handleTimeSelected = (targetId: string | 'new', selectedTime: string) => {
    const isDuplicate = isDuplicateReminderTime(
      times,
      selectedTime,
      targetId === 'new' ? undefined : targetId
    );

    if (isDuplicate) {
      Alert.alert(
        'Duplicate Reminder Time',
        `A dose is already scheduled for ${formatTime12Hour(selectedTime)}. Each dose reminder must have a distinct time.`
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
            const isDefaultLabel = !item.label || ['Morning', 'Afternoon', 'Evening', 'Night'].includes(item.label);
            return {
              ...item,
              time: selectedTime,
              label: isDefaultLabel ? getTimeLabel(selectedTime) : item.label,
            };
          })
          .sort((a, b) => a.time.localeCompare(b.time))
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
      0
    );

    if (Platform.OS === 'android') {
      try {
        DateTimePickerAndroid.open({
          value: dateObj,
          mode: 'time',
          is24Hour: false,
          onChange: (event: DateTimePickerEvent, selectedDate?: Date) => {
            if (event.type === 'set' && selectedDate) {
              const hours = String(selectedDate.getHours()).padStart(2, '0');
              const minutes = String(selectedDate.getMinutes()).padStart(2, '0');
              handleTimeSelected(targetId, `${hours}:${minutes}`);
            }
          },
        });
        return;
      } catch (err) {
        console.warn('Native Android time picker unavailable, falling back to modal', err);
      }
    }

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

  const addPresetTime = (presetTime: string) => {
    if (isDuplicateReminderTime(times, presetTime)) {
      Alert.alert(
        'Duplicate Reminder Time',
        `A dose is already scheduled for ${formatTime12Hour(presetTime)}.`
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
    if (!selectedMed) {
      Alert.alert('Error', 'Please select a medicine first.');
      return;
    }

    // Validate global dose amount
    const amountValidation = validateDoseAmount(amount);
    if (!amountValidation.valid) {
      setAmountError(amountValidation.error || 'Invalid dose amount');
      Alert.alert('Invalid Dose Amount', amountValidation.error);
      return;
    }

    // Validate all reminder times (duplicate check, time format check, per-dose amount check)
    const timesValidation = validateReminderTimes(times);
    if (!timesValidation.valid) {
      Alert.alert('Schedule Validation Error', timesValidation.error);
      return;
    }

    // Ask Android/iOS for notification permission at the point the user enables reminders.
    let canNotify = notificationsEnabled;
    if (notificationsEnabled) {
      canNotify = await notificationService.requestPermissions();
      if (!canNotify) {
        Alert.alert(
          'Notifications are disabled',
          'The schedule can be saved, but alarm-style reminders will not alert you until you allow notifications in system settings.'
        );
      }
    }

    // Use local calendar date (not UTC) and preserve the recurrence anchor when editing.
    const existingSchedule = scheduleRepository.getByMedicineId(selectedMed.id);
    const scheduleId = existingSchedule?.id ?? `sched_${selectedMed.id}`;
    const now = new Date().toISOString();

    const alarmsScheduled = await saveSchedule({
      id: scheduleId,
      medicineId: selectedMed.id,
      recurrence,
      startDate: existingSchedule?.startDate ?? (date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getTodayDateString()),
      endDate: existingSchedule?.endDate,
      times,
      enabled: true,
      notificationsEnabled: canNotify,
      createdAt: existingSchedule?.createdAt ?? now,
      updatedAt: now,
    });

    if (!alarmsScheduled) {
      Alert.alert(
        'Schedule saved without alarms',
        'Your medication schedule was saved, but at least one alarm could not be scheduled. Allow notifications and “Alarms & reminders” access in Android Settings, then edit and save this schedule again.',
        [{ text: 'OK', onPress: () => router.back() }]
      );
      return;
    }

    Alert.alert(
      'Success',
      canNotify
        ? 'Medication schedule saved and alarm reminders scheduled.'
        : 'Medication schedule saved. Alarm reminders are OFF until you grant notification and exact-alarm access.',
      [{ text: 'OK', onPress: () => router.back() }]
    );
  };

  const recurrenceOptions: Array<{ type: RecurrenceType; label: string }> = [
    { type: 'daily', label: 'Every Day' },
    { type: 'weekly', label: 'Every Week' },
    { type: 'monthly', label: 'Every Month' },
    { type: 'once', label: 'Once' },
  ];

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
            <View style={styles.medRow}>
              <MedicineIcon
                form={selectedMed.dosageForm}
                name={selectedMed.name}
                size={46}
              />
              <View style={styles.medInfo}>
                <Text style={styles.medName}>{selectedMed.name}</Text>
                <Text style={styles.medSub}>
                  {selectedMed.strength} · {selectedMed.dosageForm}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={styles.noMedText}>No medicine selected</Text>
          )}

          <TextInput
            style={styles.medicineSearchInput}
            value={medicineSearch}
            onChangeText={setMedicineSearch}
            placeholder="Search medicines..."
            placeholderTextColor={Colors.textTertiary}
            accessibilityLabel="Search medicines"
          />
          {/* Searchable medicine switcher */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.medChipsScroll}
          >
            {medicines
              .filter((m) =>
                `${m.name} ${m.strength}`
                  .toLowerCase()
                  .includes(medicineSearch.trim().toLowerCase())
              )
              .map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.medChip,
                    selectedMed?.id === m.id && styles.medChipActive,
                  ]}
                  onPress={() => setSelectedMed(m)}
                >
                  <Text
                    style={[
                      styles.medChipText,
                      selectedMed?.id === m.id && styles.medChipTextActive,
                    ]}
                  >
                    {m.name}
                  </Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
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
              onPress={() => setRecurrence(opt.type)}
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

        {/* Reminder Times Section */}
        <View style={styles.reminderHeading}>
          <SectionHeader title="Reminder Times" />
          <TouchableOpacity
            onPress={() => setEditingTimes((value) => !value)}
            accessibilityRole="button"
            accessibilityLabel={editingTimes ? 'Finish editing reminder times' : 'Edit reminder times and dose amounts'}
          >
            <Text style={styles.editAction}>{editingTimes ? 'Done' : 'Edit'}</Text>
          </TouchableOpacity>
        </View>

        <AppCard style={styles.card}>
          {times.map((t) => (
            <View key={t.id} style={styles.timeRow}>
              <View style={styles.timeCol}>
                {editingTimes ? (
                  <TextInput
                    style={styles.timeValueInput}
                    value={t.label ?? ''}
                    onChangeText={(label) =>
                      setTimes(
                        times.map((item) =>
                          item.id === t.id ? { ...item, label } : item
                        )
                      )
                    }
                    placeholder="Dose name (e.g. Morning)"
                    placeholderTextColor={Colors.textTertiary}
                    accessibilityLabel={`Dose name for ${t.time}`}
                  />
                ) : (
                  <Text style={styles.timeValueText}>{t.label || getTimeLabel(t.time)}</Text>
                )}

                {editingTimes ? (
                  <View style={styles.doseAmountRow}>
                    <Text style={styles.doseAmountPrefix}>Dose:</Text>
                    <TextInput
                      style={styles.doseAmountInlineInput}
                      value={t.amount}
                      onChangeText={(val) => handleDoseAmountChange(t.id, val)}
                      placeholder="e.g. 1 tablet"
                      placeholderTextColor={Colors.textTertiary}
                      accessibilityLabel={`Dose amount for ${t.label || t.time}`}
                    />
                  </View>
                ) : (
                  <Text style={styles.doseNote}>{t.amount || amount}</Text>
                )}
              </View>

              <View style={styles.timeActions}>
                <TouchableOpacity
                  style={styles.timePickerButton}
                  onPress={() => openTimePicker(t.id, t.time)}
                  accessibilityRole="button"
                  accessibilityLabel={`Change time for ${t.label || 'dose'}, currently ${formatTime12Hour(t.time)}`}
                  activeOpacity={0.7}
                >
                  <Feather name="clock" size={15} color={Colors.primary} style={styles.clockIcon} />
                  <Text style={styles.timePickerButtonText}>{formatTime12Hour(t.time)}</Text>
                </TouchableOpacity>

                {editingTimes && (
                  <TouchableOpacity
                    style={styles.deleteTimeButton}
                    onPress={() => removeTime(t.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete reminder time ${formatTime12Hour(t.time)}`}
                  >
                    <Ionicons name="trash-outline" size={18} color={Colors.error} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}

          {/* Add time & Presets */}
          {editingTimes && (
            <>
              <TouchableOpacity
                style={styles.addAnotherTime}
                onPress={() => openTimePicker('new', getNextSuggestedTime())}
                accessibilityRole="button"
                accessibilityLabel="Pick time and add dose"
              >
                <Ionicons name="time-outline" size={20} color={Colors.primary} />
                <Text style={styles.addAnotherText}>Pick Time & Add Dose</Text>
              </TouchableOpacity>

              <Text style={styles.presetsLabel}>Quick Add Presets</Text>
              <View style={styles.presetRow}>
                {['08:00', '14:00', '18:00', '22:00'].map((preset) => {
                  const isAdded = times.some((t) => t.time === preset);
                  return (
                    <TouchableOpacity
                      key={preset}
                      style={[styles.presetChip, isAdded && styles.presetChipDisabled]}
                      onPress={() => addPresetTime(preset)}
                      accessibilityRole="button"
                      accessibilityLabel={`Add preset ${getTimeLabel(preset)} at ${formatTime12Hour(preset)}`}
                    >
                      <Text style={[styles.presetChipText, isAdded && styles.presetChipTextDisabled]}>
                        {isAdded ? '✓ ' : '+ '}
                        {getTimeLabel(preset)} · {formatTime12Hour(preset)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </AppCard>

        {/* Dosage Amount */}
        <SectionHeader title="Dose Amount" />
        <AppCard style={styles.card}>
          <TextInput
            style={[styles.amountInput, amountError ? styles.inputError : null]}
            value={amount}
            onChangeText={handleGlobalAmountChange}
            placeholder="e.g. 1 tablet, 2 drops, 5 ml"
            placeholderTextColor={Colors.textTertiary}
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

        {/* Notification Toggle */}
        <SectionHeader title="Notifications" />
        <AppCard style={styles.card}>
          <TouchableOpacity
            style={styles.toggleRow}
            onPress={() => setNotificationsEnabled(!notificationsEnabled)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleTitle}>Send Notifications</Text>
              <Text style={styles.toggleSub}>
                Receive alerts on this device at scheduled times
              </Text>
            </View>
            <Ionicons
              name={notificationsEnabled ? 'checkbox' : 'square-outline'}
              size={24}
              color={notificationsEnabled ? Colors.primary : Colors.textTertiary}
            />
          </TouchableOpacity>
        </AppCard>

        {/* Save Button */}
        <View style={styles.saveContainer}>
          <AppButton
            title="Save Medication Schedule"
            onPress={handleSave}
            variant="primary"
            size="lg"
          />
        </View>
      </View>

      {/* Time Picker Modal for iOS / Web */}
      {pickerTarget && (
        <Modal
          transparent
          animationType="fade"
          visible={pickerTarget !== null}
          onRequestClose={closePickerModal}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={closePickerModal}
          >
            <View
              style={styles.modalContent}
              onStartShouldSetResponder={() => true}
            >
              <View style={styles.modalHeader}>
                <TouchableOpacity
                  onPress={closePickerModal}
                  style={styles.modalHeaderBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>Select Dose Time</Text>
                <TouchableOpacity
                  onPress={confirmPickerModal}
                  style={styles.modalHeaderBtn}
                  accessibilityRole="button"
                >
                  <Text style={styles.modalDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.pickerWrapper}>
                <DateTimePicker
                  value={tempPickerDate}
                  mode="time"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  is24Hour={false}
                  onChange={(_event, date) => {
                    if (date) setTempPickerDate(date);
                  }}
                  textColor={Colors.textPrimary}
                />
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 60,
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
    marginBottom: 12,
  },
  medInfo: {
    marginLeft: 12,
    flex: 1,
  },
  medName: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  medSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  noMedText: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  medicineSearchInput: {
    fontSize: 14,
    color: Colors.textPrimary,
    backgroundColor: '#F8F8F9',
    borderRadius: Radius.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  medChipsScroll: {
    marginTop: 4,
  },
  medChip: {
    backgroundColor: '#F0EFEF',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    marginRight: 8,
  },
  medChipActive: {
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  medChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  medChipTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  recurrenceContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: Spacing.lg,
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
  editAction: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  timeCol: {
    flex: 1,
    marginRight: 12,
  },
  timeValueInput: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  timeValueText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  doseAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  doseAmountPrefix: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginRight: 4,
  },
  doseAmountInlineInput: {
    fontSize: 13,
    color: Colors.textPrimary,
    paddingVertical: 1,
    paddingHorizontal: 4,
    minWidth: 80,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  doseNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  timeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0EFF3',
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 104,
  },
  clockIcon: {
    marginRight: 6,
  },
  timePickerButtonText: {
    fontSize: 14,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  deleteTimeButton: {
    padding: 8,
  },
  addAnotherTime: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8E7ED',
    borderRadius: Radius.pill,
    paddingVertical: 14,
    marginTop: 14,
    marginBottom: 8,
  },
  addAnotherText: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  presetsLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 12,
    marginBottom: 8,
    fontWeight: '600',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    backgroundColor: Colors.primaryLight,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
  },
  presetChipDisabled: {
    backgroundColor: '#F0EFF3',
    opacity: 0.75,
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  presetChipTextDisabled: {
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  amountInput: {
    fontSize: 15,
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
    marginBottom: Spacing.xl,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
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
});
