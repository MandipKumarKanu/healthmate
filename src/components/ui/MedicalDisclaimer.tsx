import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Spacing } from '../../theme/tokens';

export interface MedicalDisclaimerProps {
  text?: string;
  subtext?: string;
}

export function MedicalDisclaimer({
  text = 'For organization and information only. Follow your prescription label and your healthcare professional’s instructions.',
  subtext = 'Fictional records shown throughout this concept.',
}: MedicalDisclaimerProps) {
  return (
    <View style={styles.container}>
      <View style={styles.contentRow}>
        <Feather name="shield" size={14} color="#8A8991" style={styles.icon} />
        <Text style={styles.text}>{text}</Text>
      </View>
      {subtext ? <Text style={styles.subtext}>{subtext}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  icon: {
    marginRight: 8,
    marginTop: 2,
  },
  text: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
    color: '#8A8991',
  },
  subtext: {
    fontSize: 12,
    color: '#8A8991',
    marginTop: 14,
    textAlign: 'center',
  },
});
