import React from 'react';
import { AppDialog, type AppDialogButton } from './AppDialog';

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const buttons: AppDialogButton[] = [
    { text: cancelText, style: 'cancel', onPress: onCancel },
    {
      text: confirmText,
      style: destructive ? 'destructive' : 'default',
      onPress: onConfirm,
    },
  ];

  return (
    <AppDialog
      visible={visible}
      title={title}
      message={message}
      iconName={destructive ? 'warning-outline' : 'shield-checkmark-outline'}
      buttons={buttons}
      onRequestClose={onCancel}
    />
  );
}
