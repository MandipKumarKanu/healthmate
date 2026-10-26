import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
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
import { Medicine, RecurrenceType, ReminderTime } from '../../types';

export default function SetReminderScreen() {
  const router = useRouter();
  const { medicineId } = useLocalSearchParams<{ medicineId?: string }>();
  const { saveSchedule } = useReminderStore();

  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [selectedMed, setSelectedMed] = useState<Medicine | null>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceType>('daily');
  const [times, setTimes] = useState<ReminderTime[]>([
    { id: 't_1', time: '08:00', amount: '1 tablet' },
  ]);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [amount, setAmount] = useState('1 tablet');
  const [medicineSearch, setMedicineSearch] = useState('');

  useEffect(() => {
    const list = medicineRepository.getAll();
    setMedicines(list);

    if (medicineId) {
      const match = list.find((m) => m.id === medicineId);
      if (match) setSelectedMed(match);
      const existingSched = scheduleRepository.getByMedicineId(medicineId);
      if (existingSched) {
        setRecurrence(existingSched.recurrence);
        setTimes(existingSched.times);
        setNotificationsEnabled(existingSched.notificationsEnabled);
      }
    } else if (list.length > 0) {
      setSelectedMed(list[0]);
    }
  }, [medicineId]);

  const addTime = (newTime: string) => {
    if (times.some((t) => t.time === newTime)) {
      Alert.alert('Notice', 'This reminder time is already added.');
      return;
    }
    const newEntry: ReminderTime = {
      id: `t_${Date.now()}`,
      time: newTime,
      amount,
      label: newTime < '11:00' ? 'Morning' : newTime < '14:00' ? 'Afternoon' : newTime < '19:00' ? 'Evening' : 'Night',
    };
    setTimes([...times, newEntry].sort((a, b) => a.time.localeCompare(b.time)));
  };

  const removeTime = (id: string) => {
    if (times.length <= 1) {
      Alert.alert('Notice', 'At least one reminder time is required.');
      return;
    }
    setTimes(times.filter((t) => t.id !== id));
  };

  const handleSave = async () => {
    if (!selectedMed) {
      Alert.alert('Error', 'Please select a medicine first.');
      return;
    }

    // Use local calendar date (not UTC) and preserve the recurrence anchor when editing.
    const existingSchedule = scheduleRepository.getByMedicineId(selectedMed.id);
    const scheduleId = existingSchedule?.id ?? `sched_${selectedMed.id}`;
    const now = new Date().toISOString();

    await saveSchedule({
      id: scheduleId,
      medicineId: selectedMed.id,
      recurrence,
      startDate: existingSchedule?.startDate ?? getTodayDateString(),
      endDate: existingSchedule?.endDate,
      times,
      enabled: true,
      notificationsEnabled,
      createdAt: existingSchedule?.createdAt ?? now,
      updatedAt: now,
    });

    Alert.alert('Success', 'Medication schedule saved successfully!', [
      { text: 'OK', onPress: () => router.back() },
    ]);
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
            style={styles.amountInput}
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
            {medicines.filter((m) => `${m.name} ${m.strength}`.toLowerCase().includes(medicineSearch.trim().toLowerCase())).map((m) => (
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
        <SectionHeader title="Reminder Times" />
        <AppCard style={styles.card}>
          {times.map((t) => (
            <View key={t.id} style={styles.timeRow}>
              <View style={styles.timeCol}>
                <TextInput
                  style={styles.timeValue}
                  value={t.label ?? ''}
                  onChangeText={(label) => setTimes(times.map((item) => item.id === t.id ? { ...item, label } : item))}
                  placeholder="Dose name (e.g. Morning)"
                  placeholderTextColor={Colors.textTertiary}
                  accessibilityLabel={`Dose name for ${t.time}`}
                />
                <Text style={styles.doseNote}>{t.amount} · {t.time}</Text>
              </View>

              <TouchableOpacity
                style={styles.deleteTimeButton}
                onPress={() => removeTime(t.id)}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={Colors.error}
                />
              </TouchableOpacity>
            </View>
          ))}

          {/* Preset time buttons */}
          <Text style={styles.presetsLabel}>Add another dose time</Text>
          <View style={styles.presetRow}>
            {['08:00', '12:00', '18:00', '21:00'].map((preset) => (
              <TouchableOpacity
                key={preset}
                style={styles.presetChip}
                onPress={() => addTime(preset)}
              >
                <Text style={styles.presetChipText}>+ {preset < '11:00' ? 'Morning' : preset < '14:00' ? 'Afternoon' : preset < '19:00' ? 'Evening' : 'Night'} · {preset}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </AppCard>

        {/* Dosage Amount */}
        <SectionHeader title="Dose Amount" />
        <AppCard style={styles.card}>
          <TextInput
            style={styles.amountInput}
            value={amount}
            onChangeText={(val) => {
              setAmount(val);
              setTimes(times.map((t) => ({ ...t, amount: val })));
            }}
            placeholder="e.g. 1 tablet, 2 drops"
            placeholderTextColor={Colors.textTertiary}
          />
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
  medChipsScroll: {
    marginTop: 6,
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
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  timeCol: {
    flex: 1,
  },
  timeValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  doseNote: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  deleteTimeButton: {
    padding: 8,
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
    gap: 8,
  },
  presetChip: {
    backgroundColor: Colors.primaryLight,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
  },
  presetChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
  amountInput: {
    fontSize: 15,
    color: Colors.textPrimary,
    paddingVertical: 4,
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
});
