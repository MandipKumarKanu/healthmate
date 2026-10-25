import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons, Feather, Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius } from '../../theme/tokens';
import { DosageForm } from '../../types';

interface MedicineIconProps {
  form: DosageForm;
  name?: string;
  size?: number;
}

export function MedicineIcon({ form, name, size = 44 }: MedicineIconProps) {
  const iconSize = Math.round(size * 0.52);

  const renderIcon = () => {
    // If it's Vitamin D or contains "vitamin" or "sun"
    if (name?.toLowerCase().includes('vitamin')) {
      return <Feather name="sun" size={iconSize} color={Colors.primary} />;
    }

    switch (form) {
      case 'eye_drop':
        return <Ionicons name="water-outline" size={iconSize} color={Colors.primary} />;
      case 'softgel':
        return <Feather name="sun" size={iconSize} color={Colors.primary} />;
      case 'capsule':
      case 'tablet':
      default:
        return (
          <MaterialCommunityIcons
            name="pill"
            size={iconSize}
            color={Colors.primary}
            style={{ transform: [{ rotate: '-45deg' }] }}
          />
        );
    }
  };

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.32),
        },
      ]}
    >
      {renderIcon()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.iconContainer,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
