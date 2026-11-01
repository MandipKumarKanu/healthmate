import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing } from '../../theme/tokens';
import { ReminderSchedule } from '../../types';
import { hasReminderForDate, isScheduleDueOnDate, getTodayDateString } from '../../utils/scheduleRecurrence';

interface CalendarGridProps {
  selectedDate: string; // 'YYYY-MM-DD'
  onSelectDate: (date: string) => void;
  datesWithReminders?: Set<string>;
  schedules?: ReminderSchedule[];
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEK_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

interface DayCellProps {
  day: number;
  dateStr: string;
  isSelected: boolean;
  isToday: boolean;
  hasReminder: boolean;
  onSelect: (dateStr: string) => void;
}

function DayCell({ day, dateStr, isSelected, isToday, hasReminder, onSelect }: DayCellProps) {
  const [scaleAnim] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (isSelected) {
      scaleAnim.setValue(0.82);
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 120,
        useNativeDriver: true,
      }).start();
    }
  }, [isSelected, scaleAnim]);

  return (
    <TouchableOpacity
      style={styles.dayCell}
      onPress={() => onSelect(dateStr)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Select date ${day}`}
    >
      <Animated.View
        style={[
          styles.dayNumberCircle,
          isToday && !isSelected && styles.todaySquare,
          isSelected && styles.selectedCircle,
          isSelected && { transform: [{ scale: scaleAnim }] },
        ]}
      >
        <Text
          style={[
            styles.dayText,
            isToday && !isSelected && styles.todayDayText,
            isSelected && styles.selectedDayText,
          ]}
        >
          {day}
        </Text>
      </Animated.View>

      <View style={styles.dotContainer}>
        {hasReminder && !isSelected ? <View style={styles.reminderDot} /> : null}
      </View>
    </TouchableOpacity>
  );
}

export function CalendarGrid({
  selectedDate,
  onSelectDate,
  datesWithReminders = new Set(),
  schedules = [],
}: CalendarGridProps) {
  // Initialize current view from selectedDate
  const [selectedYear, selectedMonth, selectedDay] = selectedDate.split('-').map(Number);
  const selectedObj = new Date(selectedYear, selectedMonth - 1, selectedDay);
  const [viewYear, setViewYear] = useState(selectedObj.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedObj.getMonth()); // 0-indexed
  const [gridFadeAnim] = useState(() => new Animated.Value(1));

  // Fade transition on month change
  useEffect(() => {
    gridFadeAnim.setValue(0.4);
    Animated.timing(gridFadeAnim, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [viewMonth, viewYear, gridFadeAnim]);

  // Keep the visible month in sync when selectedDate changes from outside
  // (e.g. a date tapped in another screen) across month/year boundaries.
  // This depends ONLY on selectedDate: browsing with the arrows changes
  // viewYear/viewMonth without touching selectedDate, so month navigation
  // is never fought or reset by this effect.
  useEffect(() => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return;
    setViewYear(y);
    setViewMonth(m - 1); // 0-indexed
  }, [selectedDate]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Generate calendar days
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 = Sun

  const days: Array<{ day: number | null; dateStr: string | null }> = [];

  // Padding days before month starts
  for (let i = 0; i < firstDayOfWeek; i++) {
    days.push({ day: null, dateStr: null });
  }

  // Days of month
  for (let d = 1; d <= daysInMonth; d++) {
    const monthStr = String(viewMonth + 1).padStart(2, '0');
    const dayStr = String(d).padStart(2, '0');
    days.push({
      day: d,
      dateStr: `${viewYear}-${monthStr}-${dayStr}`,
    });
  }

  return (
    <View style={styles.card}>
      {/* Month Navigation Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.monthSelector} activeOpacity={0.7}>
          <Text style={styles.monthText}>
            {MONTH_NAMES[viewMonth]} {viewYear}
          </Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={Colors.primary}
            style={{ marginLeft: 4 }}
          />
        </TouchableOpacity>

        <View style={styles.navArrows}>
          <TouchableOpacity
            style={styles.arrowButton}
            onPress={handlePrevMonth}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.arrowButton}
            onPress={handleNextMonth}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-forward" size={18} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Weekday Labels */}
      <View style={styles.weekRow}>
        {WEEK_DAYS.map((wd) => (
          <Text key={wd} style={styles.weekDayText}>
            {wd}
          </Text>
        ))}
      </View>

      {/* Days Grid */}
      <Animated.View style={[styles.daysGrid, { opacity: gridFadeAnim }]}>
        {days.map((item, idx) => {
          if (!item.day || !item.dateStr) {
            return <View key={`empty-${idx}`} style={styles.dayCell} />;
          }

          const isSelected = item.dateStr === selectedDate;
          const isToday = item.dateStr === getTodayDateString();
          const dateKey = item.dateStr;
          const hasScheduledReminder = hasReminderForDate(schedules, dateKey);
          const hasReminder = datesWithReminders.has(dateKey) || hasScheduledReminder;

          return (
            <DayCell
              key={item.dateStr}
              day={item.day}
              dateStr={item.dateStr}
              isSelected={isSelected}
              isToday={isToday}
              hasReminder={hasReminder}
              onSelect={onSelectDate}
            />
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.cardBackground,
    borderRadius: Radius.card,
    padding: Spacing.cardPadding,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  monthSelector: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  navArrows: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  arrowButton: {
    padding: 4,
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  weekDayText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textTertiary,
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    alignItems: 'center',
    paddingVertical: 5,
  },
  dayNumberCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  todaySquare: {
    borderRadius: 8,
    backgroundColor: '#E8F2FD',
    borderWidth: 1.5,
    borderColor: '#93C5FD',
  },
  selectedCircle: {
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  dayText: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  todayDayText: {
    color: Colors.primary,
    fontWeight: '700',
  },
  selectedDayText: {
    color: Colors.textInverse,
    fontWeight: '700',
  },
  dotContainer: {
    height: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 2,
  },
  reminderDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
});
