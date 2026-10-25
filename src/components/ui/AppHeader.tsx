import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Typography, Spacing, Radius } from '../../theme/tokens';

interface AppHeaderProps {
  title: string;
  subtitle?: string;
  brandText?: string;
  onBackPress?: () => void;
  onAddPress?: () => void;
  onMenuPress?: () => void;
  avatarText?: string;
  rightAction?: React.ReactNode;
}

export function AppHeader({
  title,
  subtitle,
  brandText = 'HealthMate AI',
  onBackPress,
  onAddPress,
  onMenuPress,
  avatarText,
  rightAction,
}: AppHeaderProps) {
  return (
    <View style={styles.container}>
      {/* Top brand & actions bar */}
      <View style={styles.topBar}>
        {onBackPress ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={onBackPress}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.brandText}>{brandText}</Text>
        )}

        <View style={styles.rightContainer}>
          {rightAction ? (
            rightAction
          ) : onAddPress ? (
            <TouchableOpacity
              style={styles.addButton}
              onPress={onAddPress}
              activeOpacity={0.7}
            >
              <Text style={styles.addButtonText}>+ Add</Text>
            </TouchableOpacity>
          ) : avatarText ? (
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{avatarText}</Text>
            </View>
          ) : onMenuPress ? (
            <TouchableOpacity
              style={styles.menuButton}
              onPress={onMenuPress}
              activeOpacity={0.7}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={18}
                color={Colors.textPrimary}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Main Title & Subtitle */}
      <View style={styles.titleContainer}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.screenPaddingHorizontal,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 32,
    marginBottom: Spacing.xs,
  },
  brandText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardBackground,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  backText: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.textPrimary,
    marginLeft: 2,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  addButton: {
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.primary,
  },
  menuButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleContainer: {
    marginTop: 2,
  },
  title: {
    ...Typography.displayLarge,
    fontSize: 30,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  subtitle: {
    ...Typography.bodyMedium,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
