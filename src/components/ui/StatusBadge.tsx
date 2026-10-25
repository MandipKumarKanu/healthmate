import React from 'react';
import { StyleSheet, View, Text, ViewStyle, StyleProp } from 'react-native';
import { Colors } from '../../theme/colors';
import { Radius } from '../../theme/tokens';

export type StatusBadgeType =
  | 'taken'
  | 'missed'
  | 'skipped'
  | 'upcoming'
  | 'expired'
  | 'reminders-on';

interface StatusBadgeProps {
  status: StatusBadgeType;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatusBadge({ status, label, style }: StatusBadgeProps) {
  const getBadgeConfig = () => {
    switch (status) {
      case 'taken':
        return {
          bg: Colors.successLight,
          textColor: Colors.success,
          text: label ?? 'Taken',
        };
      case 'missed':
        return {
          bg: Colors.errorLight,
          textColor: Colors.error,
          text: label ?? 'Missed',
        };
      case 'skipped':
        return {
          bg: Colors.skippedLight,
          textColor: Colors.skipped,
          text: label ?? 'Skipped',
        };
      case 'upcoming':
        return {
          bg: Colors.upcomingLight,
          textColor: Colors.upcoming,
          text: label ?? 'Upcoming',
        };
      case 'expired':
        return {
          bg: Colors.errorLight,
          textColor: Colors.error,
          text: label ?? 'Expired',
        };
      case 'reminders-on':
        return {
          bg: Colors.primaryLight,
          textColor: Colors.primary,
          text: label ?? 'Reminders on',
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, style]}>
      <Text style={[styles.badgeText, { color: config.textColor }]}>
        {config.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
