import React from 'react';
import { Tabs } from 'expo-router';
import { CustomBottomTabBar, TabName } from '../../components/ui/CustomBottomTabBar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={({ state, navigateToTab }) => {
        const currentRoute = state.routes[state.index].name as TabName;
        return (
          <CustomBottomTabBar
            activeTab={currentRoute}
            onTabPress={(tab) => {
              const targetRoute = state.routes.find((r) => r.name === tab);
              if (targetRoute) {
                navigateToTab(targetRoute.key);
              }
            }}
          />
        );
      }}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar' }} />
      <Tabs.Screen name="scan" options={{ title: 'Scan' }} />
      <Tabs.Screen name="medicines" options={{ title: 'Medicines' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
