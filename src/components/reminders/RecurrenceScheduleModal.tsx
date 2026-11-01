import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../theme/colors';
import { Radius, Spacing } from '../../theme/tokens';
import { RecurrenceType } from '../../types';
import {
  parseDateParts,
  formatDateParts,
  getTodayDateString,
} from '../../utils/scheduleRecurrence';

/* ─────────────────────────── exported helpers ────────────────────────── */

export function computeEndDateForDuration(
  startDate: string,
  recurrence: RecurrenceType,
  count: number,
): string {
  const parts = parseDateParts(startDate);
  if (!parts) return startDate;

  if (recurrence === 'weekly' || recurrence === 'custom') {
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    d.setUTCDate(d.getUTCDate() + (count - 1) * 7);
    return formatDateParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (recurrence === 'monthly') {
    const startDay = parts[2];
    const targetMonth = parts[1] - 1 + (count - 1);
    const targetYear = parts[0] + Math.floor(targetMonth / 12);
    const nm = targetMonth % 12;
    const lastDay = new Date(Date.UTC(targetYear, nm + 1, 0)).getUTCDate();
    return formatDateParts(targetYear, nm + 1, Math.min(startDay, lastDay));
  }
  if (recurrence === 'daily') {
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    d.setUTCDate(d.getUTCDate() + (count - 1));
    return formatDateParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return startDate;
}

export function formatFriendlyDate(dateStr: string): string {
  const parts = parseDateParts(dateStr);
  if (!parts) return dateStr;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatShortDate(dateStr: string): string {
  const parts = parseDateParts(dateStr);
  if (!parts) return dateStr;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Checks whether dateStr is a recurrence occurrence between startDate and optional endDate. */
function isOccurrence(
  dateStr: string,
  recurrence: RecurrenceType,
  startDate: string,
  endDate: string | undefined,
  daysOfWeek?: number[],
): boolean {
  if (dateStr <= startDate) return false;
  if (endDate && dateStr > endDate) return false;

  if (recurrence === 'daily') return true;

  const sParts = parseDateParts(startDate);
  const dParts = parseDateParts(dateStr);
  if (!sParts || !dParts) return false;

  if (recurrence === 'weekly') {
    const sMs = Date.UTC(sParts[0], sParts[1] - 1, sParts[2]);
    const dMs = Date.UTC(dParts[0], dParts[1] - 1, dParts[2]);
    return (dMs - sMs) % (7 * 86400000) === 0;
  }
  if (recurrence === 'monthly') {
    return dParts[2] === sParts[2];
  }
  if (recurrence === 'custom') {
    if (daysOfWeek && daysOfWeek.length > 0) {
      const targetDay = new Date(Date.UTC(dParts[0], dParts[1] - 1, dParts[2])).getUTCDay();
      return daysOfWeek.includes(targetDay);
    }
    return false;
  }
  return false;
}

/* ─────────────────────────── constants ───────────────────────────────── */

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const WEEK_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const DAY_OPTIONS = [
  { dayIndex: 0, label: 'Sun' },
  { dayIndex: 1, label: 'Mon' },
  { dayIndex: 2, label: 'Tue' },
  { dayIndex: 3, label: 'Wed' },
  { dayIndex: 4, label: 'Thu' },
  { dayIndex: 5, label: 'Fri' },
  { dayIndex: 6, label: 'Sat' },
];

/* ─────────────────────────── types ──────────────────────────────────── */

interface RecurrenceScheduleModalProps {
  visible: boolean;
  initialRecurrence: RecurrenceType;
  initialStartDate?: string;
  initialEndDate?: string;
  initialDaysOfWeek?: number[];
  onClose: () => void;
  onApply: (config: {
    recurrence: RecurrenceType;
    startDate: string;
    endDate?: string;
    daysOfWeek?: number[];
  }) => void;
}

type ActiveTarget = 'start' | 'end';

/* ─────────────────────────── component ──────────────────────────────── */

export function RecurrenceScheduleModal({
  visible,
  initialRecurrence,
  initialStartDate,
  initialEndDate,
  initialDaysOfWeek,
  onClose,
  onApply,
}: RecurrenceScheduleModalProps) {
  const today = useMemo(() => getTodayDateString(), []);

  const [recurrence, setRecurrence] = useState<RecurrenceType>(initialRecurrence);
  const [startDate, setStartDate] = useState<string>(
    initialStartDate && initialStartDate >= today ? initialStartDate : today,
  );
  const [hasEndDate, setHasEndDate] = useState<boolean>(Boolean(initialEndDate));
  const [endDate, setEndDate] = useState<string | undefined>(initialEndDate);
  const [activeTarget, setActiveTarget] = useState<ActiveTarget>('start');
  const [selectedDaysOfWeek, setSelectedDaysOfWeek] = useState<number[]>(
    initialDaysOfWeek && initialDaysOfWeek.length > 0 ? initialDaysOfWeek : [1, 3, 5],
  );

  const [viewYear, setViewYear] = useState<number>(() => {
    const s = (initialStartDate && initialStartDate >= today ? initialStartDate : today).split('-');
    return Number(s[0]);
  });
  const [viewMonth, setViewMonth] = useState<number>(() => {
    const s = (initialStartDate && initialStartDate >= today ? initialStartDate : today).split('-');
    return Number(s[1]) - 1;
  });

  /* ── sync on modal open ── */
  useEffect(() => {
    if (!visible) return;
    setRecurrence(initialRecurrence);
    const s = initialStartDate && initialStartDate >= today ? initialStartDate : today;
    setStartDate(s);
    setHasEndDate(Boolean(initialEndDate));
    setEndDate(initialEndDate);
    if (initialDaysOfWeek && initialDaysOfWeek.length > 0) {
      setSelectedDaysOfWeek(initialDaysOfWeek);
    } else {
      const parts = parseDateParts(s);
      if (parts) {
        const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
        setSelectedDaysOfWeek([d]);
      } else {
        setSelectedDaysOfWeek([1, 3, 5]);
      }
    }
    setActiveTarget('start');
    const sp = s.split('-');
    setViewYear(Number(sp[0]));
    setViewMonth(Number(sp[1]) - 1);
  }, [visible, initialRecurrence, initialStartDate, initialEndDate, initialDaysOfWeek, today]);

  /* ── month navigation: prevent navigating before current month ── */
  const [tYear, tMonth] = useMemo(() => today.split('-').map(Number), [today]);
  const isCurrentMonthOrPast = viewYear < tYear || (viewYear === tYear && viewMonth <= tMonth - 1);

  const prevMonth = () => {
    if (isCurrentMonthOrPast) return;
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  /* ── jump to current month (Today button) ── */
  const handleJumpToToday = useCallback(() => {
    setViewYear(tYear);
    setViewMonth(tMonth - 1);
  }, [tYear, tMonth]);

  /* ── toggle single day of week in custom mode ── */
  const toggleDayOfWeek = (dayIdx: number) => {
    setSelectedDaysOfWeek((prev) => {
      if (prev.includes(dayIdx)) {
        if (prev.length === 1) return prev; // Keep at least one day selected
        return prev.filter((d) => d !== dayIdx);
      }
      return [...prev, dayIdx].sort((a, b) => a - b);
    });
  };

  /* ── handle toggle end date ── */
  const handleToggleEndDate = (val: boolean) => {
    setHasEndDate(val);
    if (val) {
      const defaultWeeks = recurrence === 'weekly' || recurrence === 'custom' ? 4 : recurrence === 'monthly' ? 2 : 14;
      const computed = computeEndDateForDuration(startDate, recurrence, defaultWeeks);
      setEndDate(endDate || computed);
      setActiveTarget('end');
    } else {
      setEndDate(undefined);
      setActiveTarget('start');
    }
  };

  /* ── day tap on calendar: disallow past dates ── */
  const handleDayTap = (dateStr: string) => {
    if (dateStr < today) return;

    if (recurrence === 'once' || !hasEndDate) {
      setStartDate(dateStr);
      return;
    }

    if (activeTarget === 'start') {
      setStartDate(dateStr);
      // If start date is moved past end date, adjust end date forward
      if (endDate && dateStr >= endDate) {
        setEndDate(computeEndDateForDuration(dateStr, recurrence, 4));
      }
    } else {
      // End date must be after start date
      if (dateStr <= startDate) {
        setStartDate(dateStr);
        setActiveTarget('end');
        return;
      }
      setEndDate(dateStr);
    }
  };

  /* ── calendar days grid ── */
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const firstDayOfWeek = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();

  const calendarDays = useMemo(() => {
    const days: Array<{ day: number | null; dateStr: string | null }> = [];
    for (let i = 0; i < firstDayOfWeek; i++) days.push({ day: null, dateStr: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = String(viewMonth + 1).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      days.push({ day: d, dateStr: `${viewYear}-${mStr}-${dStr}` });
    }
    return days;
  }, [viewYear, viewMonth, daysInMonth, firstDayOfWeek]);

  /* ── friendly summary text ── */
  const cadenceDescription = useMemo(() => {
    const p = parseDateParts(startDate);
    if (!p) return '';
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

    if (recurrence === 'weekly') {
      return `Repeats every ${dayName}`;
    }
    if (recurrence === 'monthly') {
      return `Repeats on the ${p[2]}th of every month`;
    }
    if (recurrence === 'daily') {
      return 'Repeats every day';
    }
    if (recurrence === 'custom') {
      if (selectedDaysOfWeek.length === 0) {
        return 'No days selected (tap days above)';
      }
      if (selectedDaysOfWeek.length === 7) {
        return 'Repeats every day';
      }
      const isWeekdays =
        selectedDaysOfWeek.length === 5 &&
        [1, 2, 3, 4, 5].every((day) => selectedDaysOfWeek.includes(day));
      if (isWeekdays) {
        return 'Repeats every weekday (Mon - Fri)';
      }
      const isWeekends =
        selectedDaysOfWeek.length === 2 &&
        [0, 6].every((day) => selectedDaysOfWeek.includes(day));
      if (isWeekends) {
        return 'Repeats every weekend (Sat, Sun)';
      }
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const sorted = [...selectedDaysOfWeek].sort((a, b) => a - b);
      return `Repeats every ${sorted.map((i) => names[i]).join(', ')}`;
    }
    return 'Single dose reminder';
  }, [startDate, recurrence, selectedDaysOfWeek]);

  /* ── apply ── */
  const handleApply = () => {
    onApply({
      recurrence,
      startDate,
      endDate: recurrence === 'once' ? startDate : hasEndDate ? endDate : undefined,
      daysOfWeek: recurrence === 'custom' ? selectedDaysOfWeek : undefined,
    });
    onClose();
  };

  const recurrenceTabs: Array<{ type: RecurrenceType; label: string; icon: string }> = [
    { type: 'daily',   label: 'Daily',   icon: 'sunny-outline' },
    { type: 'weekly',  label: 'Weekly',  icon: 'calendar-outline' },
    { type: 'monthly', label: 'Monthly', icon: 'calendar-number-outline' },
    { type: 'custom',  label: 'Custom',  icon: 'options-outline' },
    { type: 'once',    label: 'Once',    icon: 'checkmark-circle-outline' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

        <View style={styles.sheet}>
          {/* drag handle */}
          <View style={styles.handle} />

          {/* header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Repeat Schedule</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeBtn}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* ── Frequency tabs ── */}
            <Text style={styles.sectionLabel}>Frequency</Text>
            <View style={styles.freqRow}>
              {recurrenceTabs.map((tab) => {
                const active = recurrence === tab.type;
                return (
                  <TouchableOpacity
                    key={tab.type}
                    style={[styles.freqTab, active && styles.freqTabActive]}
                    onPress={() => {
                      setRecurrence(tab.type);
                      if (tab.type === 'once') {
                        setHasEndDate(false);
                        setEndDate(undefined);
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={tab.icon as React.ComponentProps<typeof Ionicons>['name']}
                      size={18}
                      color={active ? Colors.primary : Colors.textSecondary}
                    />
                    <Text style={[styles.freqTabText, active && styles.freqTabTextActive]}>
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* ── Custom Days of Week Selector (Only visible for Custom) ── */}
            {recurrence === 'custom' && (
              <View style={styles.customSection}>
                <View style={styles.customHeaderRow}>
                  <Text style={styles.customTitle}>Repeat On Days</Text>
                  <Text style={styles.customSub}>Tap to toggle active days</Text>
                </View>

                <View style={styles.daysOfWeekRow}>
                  {DAY_OPTIONS.map((opt) => {
                    const isSelected = selectedDaysOfWeek.includes(opt.dayIndex);
                    return (
                      <TouchableOpacity
                        key={opt.dayIndex}
                        style={[
                          styles.dayOfWeekCircle,
                          isSelected && styles.dayOfWeekCircleActive,
                        ]}
                        onPress={() => toggleDayOfWeek(opt.dayIndex)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.dayOfWeekText,
                            isSelected && styles.dayOfWeekTextActive,
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Quick Presets for Custom Days */}
                <View style={styles.presetsRow}>
                  <TouchableOpacity
                    style={styles.presetChip}
                    onPress={() => setSelectedDaysOfWeek([1, 2, 3, 4, 5])}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.presetChipText}>Weekdays</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.presetChip}
                    onPress={() => setSelectedDaysOfWeek([0, 6])}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.presetChipText}>Weekends</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.presetChip}
                    onPress={() => setSelectedDaysOfWeek([1, 3, 5])}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.presetChipText}>Mon / Wed / Fri</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.presetChip}
                    onPress={() => setSelectedDaysOfWeek([0, 1, 2, 3, 4, 5, 6])}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.presetChipText}>Every Day</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── Optional "Set End Date" Toggle (hidden for once) ── */}
            {recurrence !== 'once' && (
              <View style={styles.toggleCard}>
                <View style={styles.toggleInfo}>
                  <Text style={styles.toggleTitle}>Set End Date</Text>
                  <Text style={styles.toggleSub}>
                    {hasEndDate
                      ? 'Course ends on selected end date'
                      : 'Ongoing schedule · Runs indefinitely'}
                  </Text>
                </View>
                <Switch
                  value={hasEndDate}
                  onValueChange={handleToggleEndDate}
                  trackColor={{ false: '#E2E8F0', true: Colors.primaryLight }}
                  thumbColor={hasEndDate ? Colors.primary : '#FFFFFF'}
                />
              </View>
            )}

            {/* ── Active Target Selector (when end date is enabled) ── */}
            {hasEndDate && recurrence !== 'once' && (
              <View style={styles.targetRow}>
                <TouchableOpacity
                  style={[
                    styles.targetPill,
                    activeTarget === 'start' && styles.targetPillActiveStart,
                  ]}
                  onPress={() => setActiveTarget('start')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.targetDot, { backgroundColor: Colors.primary }]} />
                  <View>
                    <Text style={styles.targetPillLabel}>Start Date</Text>
                    <Text style={styles.targetPillValue}>{formatShortDate(startDate)}</Text>
                  </View>
                </TouchableOpacity>

                <Ionicons name="arrow-forward" size={14} color={Colors.textTertiary} />

                <TouchableOpacity
                  style={[
                    styles.targetPill,
                    activeTarget === 'end' && styles.targetPillActiveEnd,
                  ]}
                  onPress={() => setActiveTarget('end')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.targetDot, { backgroundColor: '#10B981' }]} />
                  <View>
                    <Text style={styles.targetPillLabel}>End Date</Text>
                    <Text style={styles.targetPillValue}>
                      {endDate ? formatShortDate(endDate) : 'Tap date'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Calendar Header Row with "Today" Button ── */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>
                {hasEndDate && recurrence !== 'once'
                  ? activeTarget === 'start'
                    ? 'Select Start Date'
                    : 'Select End Date'
                  : 'Select Date'}
              </Text>
              <TouchableOpacity
                style={styles.todayButton}
                onPress={handleJumpToToday}
                activeOpacity={0.7}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name="today-outline" size={13} color={Colors.primary} />
                <Text style={styles.todayButtonText}>Today</Text>
              </TouchableOpacity>
            </View>

            {/* ── Calendar Card ── */}
            <View style={styles.calSection}>
              {/* month nav */}
              <View style={styles.monthNav}>
                <TouchableOpacity
                  onPress={prevMonth}
                  style={[styles.navBtn, isCurrentMonthOrPast && styles.navBtnDisabled]}
                  disabled={isCurrentMonthOrPast}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="chevron-back"
                    size={18}
                    color={isCurrentMonthOrPast ? '#CBD5E1' : Colors.textPrimary}
                  />
                </TouchableOpacity>
                <Text style={styles.monthLabel}>
                  {MONTH_NAMES[viewMonth]} {viewYear}
                </Text>
                <TouchableOpacity
                  onPress={nextMonth}
                  style={styles.navBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="chevron-forward" size={18} color={Colors.textPrimary} />
                </TouchableOpacity>
              </View>

              {/* weekday headers */}
              <View style={styles.weekRow}>
                {WEEK_DAYS.map((w, i) => (
                  <Text key={i} style={styles.weekDayLabel}>{w}</Text>
                ))}
              </View>

              {/* day grid */}
              <View style={styles.daysGrid}>
                {calendarDays.map((item, idx) => {
                  if (!item.day || !item.dateStr) {
                    return <View key={`empty-${idx}`} style={styles.dayCell} />;
                  }

                  const isPast = item.dateStr < today;
                  const isSelected = item.dateStr === startDate;
                  const isEnd = hasEndDate && recurrence !== 'once' && item.dateStr === endDate;
                  const isOcc = isOccurrence(
                    item.dateStr,
                    recurrence,
                    startDate,
                    hasEndDate ? endDate : undefined,
                    recurrence === 'custom' ? selectedDaysOfWeek : undefined,
                  );
                  const isToday = item.dateStr === today;

                  return (
                    <TouchableOpacity
                      key={item.dateStr}
                      style={[styles.dayCell, isPast && styles.dayCellPast]}
                      onPress={() => handleDayTap(item.dateStr!)}
                      disabled={isPast}
                      activeOpacity={0.7}
                    >
                      <View
                        style={[
                          styles.dayCircle,
                          isToday && !isSelected && !isEnd && styles.dayCircleToday,
                          isOcc && !isPast && styles.dayCircleOcc,
                          isSelected && styles.dayCircleSelected,
                          isEnd && styles.dayCircleEnd,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            isPast && styles.dayTextPast,
                            isToday && !isSelected && !isEnd && styles.dayTextToday,
                            isOcc && !isPast && styles.dayTextOcc,
                            (isSelected || isEnd) && styles.dayTextActive,
                          ]}
                        >
                          {item.day}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Legend */}
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.primary }]} />
                  <Text style={styles.legendText}>
                    {recurrence === 'once' ? 'Selected Date' : 'Start Date'}
                  </Text>
                </View>
                {recurrence !== 'once' && (
                  <View style={styles.legendItem}>
                    <View
                      style={[
                        styles.legendDot,
                        { backgroundColor: '#EFF6FF', borderColor: '#93C5FD', borderWidth: 1.2 },
                      ]}
                    />
                    <Text style={styles.legendText}>Repeats On</Text>
                  </View>
                )}
                {hasEndDate && recurrence !== 'once' && (
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                    <Text style={styles.legendText}>End Date</Text>
                  </View>
                )}
              </View>
            </View>

            {/* ── Schedule summary card ── */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>
                  {recurrence === 'once' ? 'REMINDER DATE' : 'STARTS ON'}
                </Text>
                <Text style={styles.summaryValue}>
                  {formatFriendlyDate(startDate)}
                </Text>
              </View>

              {recurrence !== 'once' && (
                <>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>ENDS</Text>
                    <Text
                      style={[
                        styles.summaryValue,
                        !hasEndDate && { color: Colors.primary },
                      ]}
                    >
                      {hasEndDate && endDate ? formatFriendlyDate(endDate) : 'Ongoing'}
                    </Text>
                  </View>
                </>
              )}

              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>CADENCE</Text>
                <Text style={[styles.summaryValue, { color: Colors.primary }]}>
                  {cadenceDescription}
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* footer */}
          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={handleApply} activeOpacity={0.8}>
              <Text style={styles.applyBtnText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─────────────────────────── styles ─────────────────────────────────── */

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },

  /* ── frequency tabs ── */
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  freqRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: Spacing.md,
  },
  freqTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: Radius.md,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: 'transparent',
    gap: 3,
  },
  freqTabActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  freqTabText: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  freqTabTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },

  /* ── custom days section ── */
  customSection: {
    backgroundColor: '#F8FAFC',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  customHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  customTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  customSub: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  daysOfWeekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  dayOfWeekCircle: {
    flex: 1,
    paddingVertical: 8,
    marginHorizontal: 2,
    borderRadius: Radius.sm,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayOfWeekCircleActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dayOfWeekText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  dayOfWeekTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },

  /* ── toggle card ── */
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  toggleInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  toggleSub: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },

  /* ── target selector row ── */
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  targetPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: '#F1F5F9',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  targetPillActiveStart: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  targetPillActiveEnd: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  targetDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  targetPillLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
  },
  targetPillValue: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },

  /* ── section header with Today button ── */
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: Colors.primaryLight,
    borderRadius: Radius.pill,
  },
  todayButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primary,
  },

  /* ── calendar section ── */
  calSection: {
    backgroundColor: '#FAFAFA',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  navBtn: { padding: 4 },
  navBtnDisabled: {
    opacity: 0.4,
  },
  monthLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },

  /* weekdays */
  weekRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekDayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textTertiary,
  },

  /* day grid */
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    alignItems: 'center',
    paddingVertical: 3,
  },
  dayCellPast: {
    opacity: 0.3,
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 8,
  },
  dayCircleOcc: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1.2,
    borderColor: '#BFDBFE',
  },
  dayCircleSelected: {
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  dayCircleEnd: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  dayText: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.textPrimary,
  },
  dayTextPast: {
    color: '#94A3B8',
  },
  dayTextToday: {
    color: Colors.primary,
    fontWeight: '700',
  },
  dayTextOcc: {
    color: Colors.primary,
    fontWeight: '600',
  },
  dayTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  /* legend */
  legend: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'center',
    paddingTop: Spacing.sm,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '500',
  },

  /* ── summary card ── */
  summaryCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  summaryItem: {
    flex: 1,
    gap: 4,
  },
  summaryDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.sm,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
    lineHeight: 16,
  },

  /* ── footer ── */
  footer: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: Radius.lg,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  applyBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: Radius.lg,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  applyBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
