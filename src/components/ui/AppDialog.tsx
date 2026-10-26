import React, { type ComponentProps } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing, Typography } from '../../theme/tokens';

export type AppDialogButton = {
  text?: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

interface AppDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AppDialogButton[];
  iconName?: ComponentProps<typeof Ionicons>['name'];
  cancelable?: boolean;
  onRequestClose?: () => void;
  onAction?: (button: AppDialogButton) => void;
}

export function AppDialog({
  visible,
  title,
  message,
  buttons,
  iconName = 'information-circle-outline',
  cancelable = true,
  onRequestClose,
  onAction,
}: AppDialogProps) {
  const closeIfAllowed = () => {
    if (cancelable) onRequestClose?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={closeIfAllowed}
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={closeIfAllowed}
          disabled={!cancelable}
          accessibilityRole="button"
          accessibilityLabel="Dismiss dialog"
        />
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.iconBadge}>
              <Ionicons name={iconName} size={22} color={Colors.primary} />
            </View>
            <Text style={styles.title}>{title}</Text>
          </View>

          {!!message && <Text style={styles.message}>{message}</Text>}

          <View
            style={[
              styles.actions,
              buttons.length > 2 && styles.stackedActions,
            ]}
          >
            {buttons.map((button, index) => {
              const intent =
                button.style ?? (index === buttons.length - 1 ? 'default' : 'cancel');
              const isCancel = intent === 'cancel';
              const isDestructive = intent === 'destructive';

              return (
                <Pressable
                  key={index}
                  onPress={() => {
                    if (onAction) onAction(button);
                    else button.onPress?.();
                  }}
                  style={({ pressed }) => [
                    styles.action,
                    isCancel && styles.cancelAction,
                    isDestructive && styles.destructiveAction,
                    buttons.length > 2 && styles.stackedAction,
                    pressed && styles.actionPressed,
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.actionText,
                      isCancel && styles.cancelActionText,
                      isDestructive && styles.destructiveActionText,
                    ]}
                  >
                    {button.text || 'OK'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.60)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.xl,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  iconBadge: {
    width: 42,
    height: 42,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...Typography.heading2,
    color: Colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    flex: 1,
  },
  message: {
    ...Typography.bodyMedium,
    color: Colors.textSecondary,
    lineHeight: 21,
    marginBottom: Spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  stackedActions: {
    flexDirection: 'column',
  },
  action: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackedAction: {
    flex: 0,
    width: '100%',
  },
  cancelAction: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  destructiveAction: {
    backgroundColor: '#DC2626',
  },
  actionPressed: {
    opacity: 0.78,
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  cancelActionText: {
    color: Colors.textPrimary,
  },
  destructiveActionText: {
    color: '#FFFFFF',
  },
});
