import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Colors } from '../../theme/colors';
import { Spacing } from '../../theme/tokens';

interface SectionHeaderProps {
  title: string;
  actionText?: string;
  onActionPress?: () => void;
  count?: number;
}

export function SectionHeader({ title, actionText, onActionPress, count }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {title}
        {count !== undefined ? ` · ${count}` : ''}
      </Text>

      {actionText && onActionPress ? (
        <TouchableOpacity
          onPress={onActionPress}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.actionText}>{actionText}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textSecondary,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
});
