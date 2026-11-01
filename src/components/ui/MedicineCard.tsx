import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { Medicine, ReminderSchedule } from '../../types';
import { isLowStock } from '../../services/refillService';
import { formatTime12Hour } from '../../utils/reminderValidation';
import { MedicineIcon } from './MedicineIcon';
import { StatusBadge } from './StatusBadge';

interface MedicineCardProps {
  medicine: Medicine;
  schedule?: ReminderSchedule | null;
  schedules?: ReminderSchedule[] | null;
  onPress: () => void;
}

function formatScheduleItem(s: ReminderSchedule): string {
  const timesStr = s.times.map((t) => formatTime12Hour(t.time)).join(', ');
  let recurrenceStr = '';
  if (s.recurrence === 'daily') {
    recurrenceStr = 'Daily';
  } else if (s.recurrence === 'weekly') {
    recurrenceStr = 'Weekly';
  } else if (s.recurrence === 'monthly') {
    recurrenceStr = 'Monthly';
  } else if (s.recurrence === 'custom') {
    const days =
      s.daysOfWeek && s.daysOfWeek.length > 0
        ? s.daysOfWeek.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')
        : 'Custom';
    recurrenceStr = `Custom (${days})`;
  } else if (s.recurrence === 'once') {
    recurrenceStr = 'Once';
  } else {
    recurrenceStr = String(s.recurrence);
  }

  const doseAmount = s.times[0]?.amount ? ` · ${s.times[0].amount}` : '';
  return `${timesStr} · ${recurrenceStr}${doseAmount}`;
}

export function MedicineCard({ medicine, schedule, schedules, onPress }: MedicineCardProps) {
  const isExpired =
    medicine.packageDetails.expiryDate?.toLowerCase().includes('2026') ||
    medicine.packageDetails.packageDetailsText?.toLowerCase().includes('expired');

  const list = schedules ?? (schedule ? [schedule] : []);
  const activeSchedules = list.filter((s) => s.enabled && s.times.length > 0);
  const hasActiveReminder = activeSchedules.length > 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      {/* Top Section: Icon, Name/Category, Chevron */}
      <View style={styles.topRow}>
        <MedicineIcon form={medicine.dosageForm} name={medicine.name} size={46} />

        <View style={styles.nameContainer}>
          <Text style={styles.name}>{medicine.name}</Text>
          <Text style={styles.details}>
            {medicine.strength} ·{' '}
            {medicine.dosageForm.charAt(0).toUpperCase() + medicine.dosageForm.slice(1)}s ·{' '}
            {medicine.category}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={16} color={Colors.textTertiary} />
      </View>

      {/* Middle Section: Expiry Date & Badge */}
      <View style={styles.statusRow}>
        <Text style={[styles.expiryText, isExpired && styles.expiredText]}>
          Expiry {medicine.packageDetails.expiryDate ?? 'N/A'}
          {isExpired ? ' · Expired' : ''}
        </Text>

        {isExpired ? (
          <StatusBadge status="expired" />
        ) : isLowStock(medicine) ? (
          <StatusBadge status="low-stock" />
        ) : hasActiveReminder ? (
          <StatusBadge status="reminders-on" />
        ) : null}
      </View>

      {/* Bottom Section: Schedule info (each reminder on its own line) */}
      <View style={styles.schedulesContainer}>
        {activeSchedules.length > 0 ? (
          activeSchedules.map((s, idx) => (
            <View key={s.id || idx} style={styles.scheduleRow}>
              <Feather name="bell" size={13} color={Colors.primary} style={styles.bellIcon} />
              <Text style={styles.scheduleText} numberOfLines={2}>
                {formatScheduleItem(s)}
              </Text>
            </View>
          ))
        ) : (
          <View style={styles.scheduleRow}>
            <Feather name="bell-off" size={13} color={Colors.textSecondary} style={styles.bellIcon} />
            <Text style={styles.scheduleTextMuted}>No reminder set</Text>
          </View>
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
  schedulesContainer: {
    paddingTop: 6,
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    marginTop: 4,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 1,
  },
  bellIcon: {
    marginRight: 6,
  },
  scheduleText: {
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: '500',
    flex: 1,
  },
  scheduleTextMuted: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
});
