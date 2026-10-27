import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { ScheduledDose } from '../../types';
import { MedicationTimelineItem } from './MedicationTimelineItem';
import { Shadows, Spacing } from '../../theme/tokens';

export interface TodayTimelineProps {
  doses: ScheduledDose[];
  onViewAllPress: () => void;
}

export function TodayTimeline({ doses, onViewAllPress }: TodayTimelineProps) {
  // In the reference screenshot, up to 4 items are previewed in the card
  const previewDoses = doses.slice(0, 4);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>Today's timeline</Text>
        <TouchableOpacity
          onPress={onViewAllPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Text style={styles.viewAllText}>View All</Text>
        </TouchableOpacity>
      </View>

      {/* Card List */}
      <View style={styles.card}>
        {previewDoses.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No medications scheduled today</Text>
            <Text style={styles.emptySub}>Tap + on medicines to set up your daily reminders.</Text>
          </View>
        ) : (
          previewDoses.map((dose, index) => (
            <MedicationTimelineItem
              key={dose.id}
              dose={dose}
              isLast={index === previewDoses.length - 1}
            />
          ))
        )}
      </View>
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
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A8991',
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0788F5',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#ECEBF0',
    ...Shadows.card,
    elevation: 3,
    overflow: 'hidden',
  },
  emptyContainer: {
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
});
