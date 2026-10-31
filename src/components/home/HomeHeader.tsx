import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/tokens';

export interface HomeHeaderProps {
  greeting: string;
  userName: string;
  dateText: string;
  avatarText: string;
  streakCount: number;
  onAvatarPress?: () => void;
}

export function HomeHeader({
  greeting,
  userName,
  dateText,
  avatarText,
  streakCount,
  onAvatarPress,
}: HomeHeaderProps) {
  return (
    <View style={styles.container}>
      {/* Top brand & Profile initials */}
      <View style={styles.topBar}>
        <Text style={styles.brandText}>HealthMate AI</Text>
        <TouchableOpacity
          onPress={onAvatarPress}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
        >
          <Text style={styles.avatarText}>{avatarText}</Text>
        </TouchableOpacity>
      </View>

      {/* Main Greeting & Date */}
      <View style={styles.greetingSection}>
        <Text style={styles.greetingTitle}>
          {greeting}, {userName}
        </Text>
        <Text style={styles.dateSubtitle}>{dateText}</Text>
      </View>

      {/* Status Row: AI Mode & Streak */}
      <View style={styles.statusRow}>
        <Text style={styles.aiModeText}>✦ AI Mode</Text>
        <Text style={styles.streakText}>{streakCount}-day logging streak</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  brandText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8A8991',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0788F5',
    letterSpacing: 0.2,
  },
  greetingSection: {
    marginBottom: 12,
  },
  greetingTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111116',
    letterSpacing: -0.5,
  },
  dateSubtitle: {
    fontSize: 15,
    color: '#8A8991',
    marginTop: 3,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 4,
  },
  aiModeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0788F5',
  },
  streakText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F08C3A',
  },
});
