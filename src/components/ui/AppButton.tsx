import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Text,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'text' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
}: AppButtonProps) {
  const getContainerStyles = () => {
    const list: StyleProp<ViewStyle>[] = [styles.base];

    // Size
    if (size === 'sm') list.push(styles.sm);
    else if (size === 'lg') list.push(styles.lg);
    else list.push(styles.md);

    // Variant
    if (variant === 'primary') list.push(styles.primary);
    else if (variant === 'secondary') list.push(styles.secondary);
    else if (variant === 'outline') list.push(styles.outline);
    else if (variant === 'text') list.push(styles.text);
    else if (variant === 'destructive') list.push(styles.destructive);

    if (disabled || loading) list.push(styles.disabled);
    if (style) list.push(style);

    return list;
  };

  const getTextStyles = () => {
    const list: StyleProp<TextStyle>[] = [styles.baseText];

    if (size === 'sm') list.push(styles.smText);
    else if (size === 'lg') list.push(styles.lgText);

    if (variant === 'primary') list.push(styles.primaryText);
    else if (variant === 'secondary') list.push(styles.secondaryText);
    else if (variant === 'outline') list.push(styles.outlineText);
    else if (variant === 'text') list.push(styles.textVariantText);
    else if (variant === 'destructive') list.push(styles.destructiveText);

    if (disabled) list.push(styles.disabledText);
    if (textStyle) list.push(textStyle);

    return list;
  };

  return (
    <TouchableOpacity
      style={getContainerStyles()}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.75}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'primary' ? Colors.textInverse : Colors.primary}
        />
      ) : (
        <>
          {icon ? <>{icon}</> : null}
          <Text style={getTextStyles()}>{title}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  sm: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  md: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  lg: {
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
  primary: {
    backgroundColor: Colors.primary,
  },
  secondary: {
    backgroundColor: Colors.primaryLight,
  },
  outline: {
    backgroundColor: Colors.cardBackground,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  text: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  destructive: {
    backgroundColor: Colors.errorLight,
  },
  disabled: {
    opacity: 0.5,
  },
  baseText: {
    fontWeight: '600',
    fontSize: 15,
  },
  smText: {
    fontSize: 13,
  },
  lgText: {
    fontSize: 17,
  },
  primaryText: {
    color: Colors.textInverse,
  },
  secondaryText: {
    color: Colors.primary,
  },
  outlineText: {
    color: Colors.textPrimary,
  },
  textVariantText: {
    color: Colors.primary,
  },
  destructiveText: {
    color: Colors.error,
  },
  disabledText: {
    color: Colors.textSecondary,
  },
});
