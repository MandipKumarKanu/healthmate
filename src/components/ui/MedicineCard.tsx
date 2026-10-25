import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { Medicine, ReminderSchedule } from '../../types';
import { MedicineIcon } from './MedicineIcon';
import { StatusBadge } from './StatusBadge';

interface MedicineCardProps {
  medicine: Medicine;
  schedule?: ReminderSchedule | null;
  onPress: () => void;
}

export function MedicineCard({
  medicine,
  schedule,
  onPress,
}: MedicineCardProps) {
  const isExpired =
    medicine.packageDetails.expiryDate?.toLowerCase().includes('2026') ||
    medicine.packageDetails.packageDetailsText?.toLowerCase().includes('expired');

  const formatScheduleText = () => {
    if (!schedule || !schedule.enabled || schedule.times.length === 0) {
      return null;
    }
    const timesStr = schedule.times.map((t) => t.time).join(' & ');
    const recurrenceStr =
      schedule.recurrence === 'daily'
        ? 'Daily'
        : schedule.recurrence.charAt(0).toUpperCase() + schedule.recurrence.slice(1);
    return `${timesStr} · ${recurrenceStr}`;
  };

  const scheduleText = formatScheduleText();

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {/* Top Section: Icon, Name/Category, Chevron */}
      <View style={styles.topRow}>
        <MedicineIcon
          form={medicine.dosageForm}
          name={medicine.name}
          size={46}
        />

        <View style={styles.nameContainer}>
          <Text style={styles.name}>{medicine.name}</Text>
          <Text style={styles.details}>
            {medicine.strength} · {medicine.dosageForm.charAt(0).toUpperCase() + medicine.dosageForm.slice(1)}s · {medicine.category}
          </Text>
        </View>

        <Ionicons
          name="chevron-forward"
          size={16}
          color={Colors.textTertiary}
        />
      </View>

      {/* Middle Section: Expiry Date & Badge */}
      <View style={styles.statusRow}>
        <Text style={[styles.expiryText, isExpired && styles.expiredText]}>
          Expiry {medicine.packageDetails.expiryDate ?? 'N/A'}
          {isExpired ? ' · Expired' : ''}
        </Text>

        {isExpired ? (
          <StatusBadge status="expired" />
        ) : schedule?.enabled ? (
          <StatusBadge status="reminders-on" />
        ) : null}
      </View>

      {/* Bottom Section: Schedule info */}
      <View style={styles.scheduleRow}>
        {scheduleText ? (
          <>
            <Feather name="bell" size={13} color={Colors.textSecondary} />
            <Text style={styles.scheduleText}>{scheduleText}</Text>
          </>
        ) : (
          <>
            <Feather name="bell-off" size={13} color={Colors.textSecondary} />
            <Text style={styles.scheduleText}>No reminder set</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  nameContainer: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  name: {
    ...Typography.heading3,
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  details: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Spacing.sm,
  },
  expiryText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  expiredText: {
    color: Colors.error,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
  },
  scheduleText: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginLeft: 6,
    fontWeight: '500',
  },
});
