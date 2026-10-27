import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Platform, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Shadows } from '../../theme/tokens';

export type TabName = 'home' | 'calendar' | 'scan' | 'medicines' | 'profile';

interface CustomBottomTabBarProps {
  activeTab: TabName;
  onTabPress: (tab: TabName) => void;
}

interface TabItemConfig {
  key: TabName;
  label: string;
  renderIcon: (active: boolean) => React.ReactNode;
}

const TABS: TabItemConfig[] = [
  {
    key: 'home',
    label: 'Home',
    renderIcon: (active) => (
      <Ionicons
        name={active ? 'home' : 'home-outline'}
        size={20}
        color={active ? Colors.primary : '#111116'}
      />
    ),
  },
  {
    key: 'calendar',
    label: 'Calendar',
    renderIcon: (active) => (
      <Ionicons
        name={active ? 'calendar' : 'calendar-outline'}
        size={20}
        color={active ? Colors.primary : '#111116'}
      />
    ),
  },
  {
    key: 'scan',
    label: 'Scan',
    renderIcon: (active) => (
      <Ionicons
        name={active ? 'camera' : 'camera-outline'}
        size={21}
        color={active ? Colors.primary : '#111116'}
      />
    ),
  },
  {
    key: 'medicines',
    label: 'Medicines',
    renderIcon: (active) => (
      <MaterialCommunityIcons
        name="pill"
        size={20}
        color={active ? Colors.primary : '#111116'}
        style={{ transform: [{ rotate: '-45deg' }] }}
      />
    ),
  },
  {
    key: 'profile',
    label: 'Profile',
    renderIcon: (active) => (
      <Ionicons
        name={active ? 'person-circle' : 'person-circle-outline'}
        size={22}
        color={active ? Colors.primary : '#111116'}
      />
    ),
  },
];

export function CustomBottomTabBar({ activeTab, onTabPress }: CustomBottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 12);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardVisible(false),
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  if (isKeyboardVisible) {
    return null;
  }

  return (
    <View style={[styles.outerContainer, { paddingBottom: bottomPadding }]}>
      <View style={styles.dock}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabButton, isActive && styles.activePill]}
              onPress={() => onTabPress(tab.key)}
              activeOpacity={0.7}
            >
              {tab.renderIcon(isActive)}
              <Text style={[styles.tabLabel, isActive && styles.activeLabel]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    alignItems: 'center',
    backgroundColor: 'transparent',
    pointerEvents: 'box-none',
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 6,
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderColor: '#ECEBF0',
    ...Shadows.floating,
    elevation: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  activePill: {
    backgroundColor: '#E4E8EE',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#111116',
    marginTop: 2,
  },
  activeLabel: {
    color: Colors.primary,
    fontWeight: '700',
  },
});
