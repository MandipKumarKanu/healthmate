import React, {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppDialog, AppDialogButton } from '../components/ui/AppDialog';

export interface AppAlertOptions {
  cancelable?: boolean;
  onDismiss?: () => void;
}

interface AlertRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AppDialogButton[];
  options?: AppAlertOptions;
}

type AlertPresenter = (request: AlertRequest) => void;

let presenter: AlertPresenter | null = null;
let nextId = 1;
const pendingRequests: AlertRequest[] = [];

export const AppAlert = {
  alert(
    title: string,
    message?: string,
    buttons?: AppDialogButton[],
    options?: AppAlertOptions,
  ) {
    const request: AlertRequest = {
      id: nextId++,
      title,
      message,
      buttons: buttons?.length ? buttons : [{ text: 'OK' }],
      options,
    };

    if (presenter) presenter(request);
    else pendingRequests.push(request);
  },
};

export function AppAlertProvider({ children }: PropsWithChildren) {
  const [activeAlert, setActiveAlert] = useState<AlertRequest | null>(null);
  const activeAlertRef = useRef<AlertRequest | null>(null);
  const queueRef = useRef<AlertRequest[]>([]);

  const present = useCallback((request: AlertRequest) => {
    if (activeAlertRef.current) {
      queueRef.current.push(request);
      return;
    }

    activeAlertRef.current = request;
    setActiveAlert(request);
  }, []);

  useEffect(() => {
    presenter = present;
    while (pendingRequests.length > 0) {
      const request = pendingRequests.shift();
      if (request) present(request);
    }

    return () => {
      if (presenter === present) presenter = null;
    };
  }, [present]);

  const finishAlert = useCallback((button?: AppDialogButton) => {
    const completed = activeAlertRef.current;
    const next = queueRef.current.shift() ?? null;

    activeAlertRef.current = next;
    setActiveAlert(next);

    if (button) button.onPress?.();
    completed?.options?.onDismiss?.();
  }, []);

  const isCancelable = activeAlert?.options?.cancelable !== false;

  return (
    <>
      {children}
      {activeAlert && (
        <AppDialog
          visible
          title={activeAlert.title}
          message={activeAlert.message}
          buttons={activeAlert.buttons}
          cancelable={isCancelable}
          onRequestClose={() => {
            if (isCancelable) finishAlert();
          }}
          onAction={finishAlert}
        />
      )}
    </>
  );
}
