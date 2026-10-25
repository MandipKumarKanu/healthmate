import React from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Radius, Spacing } from '../../theme/tokens';

export interface AssistantPromoCardProps {
  onAskPress: () => void;
}

export function AssistantPromoCard({ onAskPress }: AssistantPromoCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <Ionicons
          name="sparkles"
          size={22}
          color="#0788F5"
          style={styles.icon}
        />
        <View style={styles.textContainer}>
          <Text style={styles.title}>HealthMate AI Mode</Text>
          <Text style={styles.subtitle}>
            A clearer understanding of the words on your medicine package.
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.askButton}
        onPress={onAskPress}
        activeOpacity={0.7}
      >
        <Text style={styles.askButtonText}>Ask about a label</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#EDF6FF',
    borderRadius: 22,
    padding: 18,
    marginBottom: Spacing.lg,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  icon: {
    marginTop: 2,
    marginRight: 10,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111116',
  },
  subtitle: {
    fontSize: 13,
    color: '#76757E',
    lineHeight: 18,
    marginTop: 3,
  },
  askButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#DDEEFF',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    marginTop: 12,
    marginLeft: 32,
  },
  askButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0788F5',
  },
});
