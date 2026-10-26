import React, { useEffect } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAppStore } from "../store/appStore";
import { notificationService } from "../services/notificationService";

export default function RootLayout() {
  const initApp = useAppStore((state) => state.initApp);

  useEffect(() => {
    initApp();
    notificationService.init().then(() => {
      notificationService.reconcileScheduledReminders();
    });

    // Recover alarms on launch, reboot, or when permissions return from system settings
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        notificationService.reconcileScheduledReminders();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [initApp]);

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#F2F1F7" },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="onboarding/profile" />
        <Stack.Screen name="onboarding/permissions" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="medicines/[id]" />
        <Stack.Screen name="medicines/add" />
        <Stack.Screen name="reminders/create" />
        <Stack.Screen name="scan-history/index" />
        <Stack.Screen name="ai-assistant/index" />
        <Stack.Screen name="health-adherence/index" />
        <Stack.Screen name="settings/privacy" />
        <Stack.Screen name="settings/disclaimer" />
        <Stack.Screen name="settings/about" />
        <Stack.Screen
          name="alarm"
          options={{
            presentation: "fullScreenModal",
            animation: "fade",
            gestureEnabled: false,
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
