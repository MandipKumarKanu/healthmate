import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';
import { DayAdherenceSummary } from '../../types';

interface DayAdherenceSummaryCardProps {
  summary: DayAdherenceSummary;
  dateLabel?: string;
}

export function DayAdherenceSummaryCard({
  summary,
  dateLabel,
}: DayAdherenceSummaryCardProps) {
  const getFormattedDate = () => {
    if (dateLabel) return dateLabel;
    const [y, m, d] = summary.date.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{getFormattedDate()}</Text>

      <View style={styles.statsRow}>
        {/* Taken */}
        <View style={styles.statCol}>
          <Text style={[styles.statValue, { color: Colors.success }]}>
            {summary.taken}
          </Text>
          <Text style={styles.statLabel}>Taken</Text>
        </View>

        {/* Remaining / Upcoming */}
        <View style={styles.statCol}>
          <Text style={[styles.statValue, { color: Colors.primary }]}>
            {summary.remaining}
          </Text>
          <Text style={styles.statLabel}>Remaining</Text>
        </View>

        {/* Missed */}
        <View style={styles.statCol}>
          <Text style={[styles.statValue, { color: Colors.error }]}>
            {summary.missed}
          </Text>
          <Text style={styles.statLabel}>Missed</Text>
        </View>

        {/* Skipped */}
        <View style={styles.statCol}>
          <Text style={[styles.statValue, { color: Colors.textPrimary }]}>
            {summary.skipped}
          </Text>
          <Text style={styles.statLabel}>Skipped</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
  },
  title: {
    ...Typography.heading3,
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCol: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
});
