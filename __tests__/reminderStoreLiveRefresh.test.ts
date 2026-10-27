import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { adherenceRepository } from '../src/database/repositories/adherenceRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { notificationService } from '../src/services/notificationService';
import { useReminderStore } from '../src/store/reminderStore';
import { DayAdherenceSummary, ReminderSchedule, ScheduledDose } from '../src/types';

const testDate = '2026-10-27';

function summary(date: string, total = 0): DayAdherenceSummary {
  return {
    date,
    total,
    taken: 0,
    remaining: total,
    missed: 0,
    skipped: 0,
    percentage: 0,
  };
}

function makeSchedule(overrides: Partial<ReminderSchedule> = {}): ReminderSchedule {
  return {
    id: 'sched_live_refresh',
    medicineId: 'medicine_live_refresh',
    recurrence: 'daily',
    startDate: testDate,
    times: [{ id: 'time_morning', time: '08:00', amount: '1 tablet', label: 'Morning' }],
    enabled: true,
    notificationsEnabled: false,
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('Reminder store live refresh', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    useReminderStore.setState({ doses: [], daySummary: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refreshes the visible date immediately after saving a schedule with notifications disabled', async () => {
    const savedDose = {
      id: 'sched_live_refresh_time_morning_2026-10-27',
      scheduleId: 'sched_live_refresh',
      medicineId: 'medicine_live_refresh',
      medicineName: 'Test medicine',
      strength: '500 mg',
      dosageForm: 'tablet',
      date: testDate,
      time: '08:00',
      amount: '1 tablet',
      status: 'upcoming',
    } as ScheduledDose;

    jest.spyOn(notificationService, 'cancelForSchedule').mockResolvedValue(undefined);
    jest.spyOn(scheduleRepository, 'save').mockImplementation(() => undefined);
    const getDosesSpy = jest
      .spyOn(adherenceRepository, 'getDosesForDate')
      .mockReturnValue([savedDose]);
    jest.spyOn(adherenceRepository, 'getDayAdherenceSummary').mockReturnValue(summary(testDate, 1));

    const result = await useReminderStore.getState().saveSchedule(makeSchedule(), testDate);

    expect(result.saved).toBe(true);
    expect(getDosesSpy).toHaveBeenCalledWith(testDate);
    expect(useReminderStore.getState().doses).toEqual([savedDose]);
    expect(useReminderStore.getState().daySummary).toEqual(summary(testDate, 1));
  });

  it('refreshes the current reminder list after deleting a schedule', async () => {
    jest.spyOn(notificationService, 'cancelForSchedule').mockResolvedValue(undefined);
    jest.spyOn(scheduleRepository, 'delete').mockReturnValue(true);
    const getDosesSpy = jest.spyOn(adherenceRepository, 'getDosesForDate').mockReturnValue([]);
    jest.spyOn(adherenceRepository, 'getDayAdherenceSummary').mockReturnValue(summary(testDate));

    await useReminderStore.getState().deleteSchedule('sched_removed', testDate);

    expect(getDosesSpy).toHaveBeenCalledWith(testDate);
    expect(useReminderStore.getState().doses).toEqual([]);
    expect(useReminderStore.getState().daySummary).toEqual(summary(testDate));
  });

  it('refreshes the reminder list after a schedule is disabled', async () => {
    jest.spyOn(scheduleRepository, 'toggleEnabled').mockImplementation(() => undefined);
    jest.spyOn(notificationService, 'cancelForSchedule').mockResolvedValue(undefined);
    const getDosesSpy = jest.spyOn(adherenceRepository, 'getDosesForDate').mockReturnValue([]);
    jest.spyOn(adherenceRepository, 'getDayAdherenceSummary').mockReturnValue(summary(testDate));

    await useReminderStore.getState().toggleScheduleEnabled('sched_disabled', false, testDate);

    expect(getDosesSpy).toHaveBeenCalledWith(testDate);
    expect(useReminderStore.getState().doses).toEqual([]);
  });
});
