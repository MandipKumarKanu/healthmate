import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons, Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Shadows, Spacing } from '../../theme/tokens';

export interface QuickActionRowProps {
  onInsightsPress: () => void;
  onScanPress: () => void;
  onCalendarPress: () => void;
}

export function QuickActionRow({
  onInsightsPress,
  onScanPress,
  onCalendarPress,
}: QuickActionRowProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>Your health, organized</Text>

      <View style={styles.card}>
        {/* Health Insights */}
        <TouchableOpacity
          style={styles.row}
          onPress={onInsightsPress}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="chart-line"
            size={22}
            color="#0788F5"
            style={styles.icon}
          />
          <View style={styles.textContainer}>
            <Text style={styles.title}>Health Insights</Text>
            <Text style={styles.subtitle}>Your adherence at a glance</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* Scan Medicine */}
        <TouchableOpacity
          style={styles.row}
          onPress={onScanPress}
          activeOpacity={0.7}
        >
          <Ionicons
            name="scan-outline"
            size={22}
            color="#0788F5"
            style={styles.icon}
          />
          <View style={styles.textContainer}>
            <Text style={styles.title}>Scan Medicine</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* View Calendar */}
        <TouchableOpacity
          style={styles.row}
          onPress={onCalendarPress}
          activeOpacity={0.7}
        >
          <Ionicons
            name="calendar-outline"
            size={22}
            color="#0788F5"
            style={styles.icon}
          />
          <View style={styles.textContainer}>
            <Text style={styles.title}>View Calendar</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A8991',
    marginBottom: 8,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  icon: {
    marginRight: 14,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111116',
  },
  subtitle: {
    fontSize: 12,
    color: '#8A8991',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F2F6',
  },
});
