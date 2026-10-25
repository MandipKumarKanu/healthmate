import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { ScheduledDose } from '../../types';
import { StatusBadge } from '../ui/StatusBadge';

export interface MedicationTimelineItemProps {
  dose: ScheduledDose;
  isLast?: boolean;
}

export function MedicationTimelineItem({
  dose,
  isLast = false,
}: MedicationTimelineItemProps) {
  return (
    <View style={[styles.itemContainer, !isLast && styles.divider]}>
      <View style={styles.leftInfo}>
        <Text style={styles.medName}>{dose.medicineName}</Text>
        <Text style={styles.detailsText}>
          {dose.time} - {dose.strength} · {dose.amount}
        </Text>
      </View>
      <StatusBadge status={dose.status} />
    </View>
  );
}

const styles = StyleSheet.create({
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: '#F3F2F6',
  },
  leftInfo: {
    flex: 1,
    paddingRight: 12,
  },
  medName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111116',
  },
  detailsText: {
    fontSize: 13,
    color: '#8A8991',
    marginTop: 3,
  },
});
