import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { ScheduledDose } from '../../types';
import { MedicineIcon } from './MedicineIcon';
import { StatusBadge } from './StatusBadge';
import { AppButton } from './AppButton';

interface ReminderCardProps {
  dose: ScheduledDose;
  onMarkTaken?: () => void;
  onSkip?: () => void;
  onMorePress?: () => void;
  onPressCard?: () => void;
}

export function ReminderCard({
  dose,
  onMarkTaken,
  onSkip,
  onMorePress,
  onPressCard,
}: ReminderCardProps) {
  const isUpcoming = dose.status === 'upcoming';

  return (
    <View style={styles.container}>
      {/* Time Header & Status Badge */}
      <View style={styles.headerRow}>
        <Text style={styles.timeText}>{dose.time}</Text>
        <StatusBadge status={dose.status} />
      </View>

      {/* Main Medicine Card */}
      <TouchableOpacity
        style={styles.card}
        onPress={onPressCard}
        activeOpacity={onPressCard ? 0.7 : 1}
      >
        <View style={styles.medRow}>
          <MedicineIcon form={dose.dosageForm} name={dose.medicineName} size={44} />

          <View style={styles.infoContainer}>
            <Text style={styles.medicineName}>{dose.medicineName}</Text>
            <Text style={styles.doseAmount}>
              {dose.strength} · {dose.amount}
            </Text>
          </View>

          <TouchableOpacity style={styles.moreButton} onPress={onMorePress} activeOpacity={0.7}>
            <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Action row for upcoming doses */}
        {isUpcoming && onMarkTaken ? (
          <View style={styles.actionRow}>
            <View style={styles.markTakenContainer}>
              <AppButton title="Mark Taken" onPress={onMarkTaken} variant="primary" size="md" />
            </View>

            {onSkip ? (
              <TouchableOpacity style={styles.skipButton} onPress={onSkip} activeOpacity={0.7}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
    paddingHorizontal: 4,
  },
  timeText: {
    ...Typography.heading2,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoContainer: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  medicineName: {
    ...Typography.heading3,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  doseAmount: {
    ...Typography.bodySmall,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  moreButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.cardBackgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },
  markTakenContainer: {
    flex: 1,
  },
  skipButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.pill,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.primary,
  },
});
