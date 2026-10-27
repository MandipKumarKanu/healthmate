import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Radius, Shadows, Spacing } from '../../theme/tokens';

export interface DailyAdherenceCardProps {
  percentage: number;
  taken: number;
  total: number;
  remaining: number;
  missed: number;
  skipped: number;
  onDetailsPress: () => void;
}

export function DailyAdherenceCard({
  percentage,
  taken,
  total,
  remaining,
  missed,
  skipped,
  onDetailsPress,
}: DailyAdherenceCardProps) {
  const getSubtext = () => {
    if (total === 0) return 'No medications scheduled today.';
    if (remaining === 1) return 'One upcoming. Keep your log up to date.';
    if (remaining > 1) return `${remaining} upcoming. Keep your log up to date.`;
    return 'All done for today! Keep your log up to date.';
  };

  return (
    <View style={styles.card}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>TODAY'S ADHERENCE</Text>
        <TouchableOpacity
          onPress={onDetailsPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Text style={styles.detailsText}>Details</Text>
        </TouchableOpacity>
      </View>

      {/* Main Stats Row */}
      <View style={styles.statsRow}>
        <Text style={styles.percentageText}>{percentage}%</Text>
        <View style={styles.textContainer}>
          <Text style={styles.summaryText}>
            {taken} of {total} reminders taken
          </Text>
          <Text style={styles.hintText}>{getSubtext()}</Text>
        </View>
      </View>

      {/* Progress Track */}
      <View style={styles.progressTrack}>
        <View
          style={[styles.progressBar, { width: `${Math.min(Math.max(percentage, 0), 100)}%` }]}
        />
      </View>

      {/* Breakdown Footnote */}
      <Text style={styles.breakdownText}>
        {missed} missed · {skipped} skipped · {remaining} upcoming
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 20,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: '#ECEBF0',
    ...Shadows.card,
    elevation: 3,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    color: '#8A8991',
    letterSpacing: 0.5,
  },
  detailsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0788F5',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  percentageText: {
    fontSize: 36,
    fontWeight: '800',
    color: '#0788F5',
    marginRight: 14,
  },
  textContainer: {
    flex: 1,
  },
  summaryText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111116',
  },
  hintText: {
    fontSize: 12,
    color: '#8A8991',
    marginTop: 3,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#EBF3FC',
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#0788F5',
    borderRadius: Radius.pill,
  },
  breakdownText: {
    fontSize: 12,
    color: '#8A8991',
    marginTop: 14,
  },
});
