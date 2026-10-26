import React, { useState, useEffect, useCallback } from 'react';
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
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
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
  const [isMedModalVisible, setIsMedModalVisible] = useState(false);
  const [modalSearch, setModalSearch] = useState('');
  const [recurrence, setRecurrence] = useState<RecurrenceType>('daily');
  const [times, setTimes] = useState<ReminderTime[]>([
    { id: 't_1', time: '08:00', amount: '1 tablet', label: 'Morning' },
  ]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [amount, setAmount] = useState('1 tablet');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [editingTimes, setEditingTimes] = useState(true);

  // Time picker state for modal display (iOS, Web, or fallback)
  const [pickerTarget, setPickerTarget] = useState<{ id: string | 'new'; date: Date } | null>(null);
  const [tempPickerDate, setTempPickerDate] = useState<Date>(new Date());

  const loadMedicines = useCallback(() => {
    try {
      const list = medicineRepository.getAll();
      setMedicines(list);
      return list;
    } catch (e) {
      console.warn("Failed to load medicines:", e);
      return [];
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const list = loadMedicines();
      if (medicineId) {
        const match = list.find((m) => m.id === medicineId);
        if (match) setSelectedMed(match);
      } else if (!selectedMed && list.length > 0) {
        setSelectedMed(list[0]);
      }
    }, [loadMedicines, medicineId, selectedMed])
  );

  useEffect(() => {
    if (medicineId) {
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

  const filteredMedicines = medicines.filter((m) =>
    `${m.name} ${m.strength} ${m.category || ''}`
      .toLowerCase()
      .includes(modalSearch.trim().toLowerCase())
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
                <MedicineIcon
                  form={selectedMed.dosageForm}
                  name={selectedMed.name}
                  size={46}
                />
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

      {/* Medicine Selection Modal */}
      <Modal
        visible={isMedModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setIsMedModalVisible(false)}
      >
        <View style={styles.medModalOverlay}>
          <View style={styles.medModalContainer}>
            {/* Modal Header */}
            <View style={styles.medModalHeader}>
              <View>
                <Text style={styles.medModalTitle}>Select Medicine</Text>
                <Text style={styles.medModalSubtitle}>
                  Choose which medication to schedule
                </Text>
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
                  <TouchableOpacity onPress={() => setModalSearch("")}>
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
                    router.push("/medicines/create");
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
              >
                {filteredMedicines.map((med) => {
                  const isSelected = selectedMed?.id === med.id;
                  return (
                    <TouchableOpacity
                      key={med.id}
                      style={[
                        styles.medModalItem,
                        isSelected && styles.medModalItemActive,
                      ]}
                      onPress={() => {
                        setSelectedMed(med);
                        setIsMedModalVisible(false);
                        setModalSearch("");

                        const existingSched = scheduleRepository.getByMedicineId(med.id);
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
                        } else {
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
                            }))
                          );
                        }
                      }}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${med.name}, ${med.strength}, ${med.dosageForm}`}
                    >
                      <MedicineIcon
                        form={med.dosageForm}
                        name={med.name}
                        size={42}
                      />
                      <View style={styles.medModalItemInfo}>
                        <Text style={styles.medModalItemName}>{med.name}</Text>
                        <Text style={styles.medModalItemSub}>
                          {med.strength} · {med.dosageForm}
                          {med.category ? ` · ${med.category}` : ""}
                        </Text>
                      </View>
                      {isSelected ? (
                        <Ionicons
                          name="checkmark-circle"
                          size={22}
                          color={Colors.primary}
                        />
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
  medModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  medModalContainer: {
    backgroundColor: Colors.cardBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 34,
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
