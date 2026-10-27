import { describe, expect, it, beforeEach } from '@jest/globals';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { adherenceRepository } from '../src/database/repositories/adherenceRepository';
import { medicineRepository } from '../src/database/repositories/medicineRepository';
import { resetDatabase } from '../src/database/client';
import { ReminderSchedule } from '../src/types';

describe('Dose history and schedule edits', () => {
  beforeEach(() => {
    resetDatabase();
    // Create a base medicine for testing
    medicineRepository.create({
      id: 'med_test_1',
      name: 'Amoxicillin',
      strength: '500 mg',
      dosageForm: 'capsule',
      category: 'Antibiotic',
      packageDetails: {},
    });
  });

  it('preserves historical dose times and statuses when editing schedule dose times', () => {
    const scheduleId = 'sched_amox_1';
    const initialSchedule: ReminderSchedule = {
      id: scheduleId,
      medicineId: 'med_test_1',
      recurrence: 'daily',
      startDate: '2026-01-01',
      times: [
        { id: 't1', time: '08:00', amount: '1 capsule', label: 'Morning' },
        { id: 't2', time: '20:00', amount: '1 capsule', label: 'Evening' },
      ],
      enabled: true,
      notificationsEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    scheduleRepository.save(initialSchedule);

    // Log doses on a past date (e.g. 2026-01-10)
    adherenceRepository.logDoseStatus(scheduleId, 'med_test_1', '2026-01-10', '08:00', 'taken');
    adherenceRepository.logDoseStatus(scheduleId, 'med_test_1', '2026-01-10', '20:00', 'taken');

    const pastSummaryBefore = adherenceRepository.getDayAdherenceSummary('2026-01-10');
    expect(pastSummaryBefore.total).toBe(2);
    expect(pastSummaryBefore.taken).toBe(2);
    expect(pastSummaryBefore.percentage).toBe(100);

    // Now edit the schedule: morning time changes from 08:00 to 09:00
    const updatedSchedule: ReminderSchedule = {
      ...initialSchedule,
      times: [
        { id: 't1', time: '09:00', amount: '1 capsule', label: 'Morning' },
        { id: 't2', time: '20:00', amount: '1 capsule', label: 'Evening' },
      ],
      updatedAt: '2026-02-01T10:00:00.000Z',
    };
    scheduleRepository.save(updatedSchedule);

    // Historical date (2026-01-10) must retain its original 08:00 and 20:00 dose identity and 100% adherence
    const pastDosesAfter = adherenceRepository.getDosesForDate('2026-01-10');
    expect(pastDosesAfter).toHaveLength(2);
    expect(pastDosesAfter.map((d) => d.time)).toEqual(['08:00', '20:00']);
    expect(pastDosesAfter.every((d) => d.status === 'taken')).toBe(true);

    const pastSummaryAfter = adherenceRepository.getDayAdherenceSummary('2026-01-10');
    expect(pastSummaryAfter.total).toBe(2);
    expect(pastSummaryAfter.taken).toBe(2);
    expect(pastSummaryAfter.percentage).toBe(100);

    // Future / post-edit date uses the new time (09:00, 20:00)
    const futureDoses = adherenceRepository.getDosesForDate('2026-12-15');
    expect(futureDoses).toHaveLength(2);
    expect(futureDoses.map((d) => d.time)).toEqual(['09:00', '20:00']);
  });

  it('persists custom dose labels and times through SQLite round-trips', () => {
    const scheduleId = 'sched_labels';
    scheduleRepository.save({
      id: scheduleId,
      medicineId: 'med_test_1',
      recurrence: 'daily',
      startDate: '2026-10-01',
      times: [
        { id: 't1', time: '08:00', amount: '1 capsule', label: 'With breakfast' },
        { id: 't2', time: '22:00', amount: '1 capsule' },
      ],
      enabled: true,
      notificationsEnabled: true,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });

    // Round-trip: custom label preserved, default label derived for time-only entry
    const loaded = scheduleRepository.getById(scheduleId);
    expect(loaded?.times).toHaveLength(2);
    expect(loaded?.times[0].label).toBe('With breakfast');
    expect(loaded?.times[1].label).toBeUndefined();
    expect(loaded?.times.map((t) => t.time)).toEqual(['08:00', '22:00']);

    // Editing labels in place updates the same row without duplicating the schedule
    scheduleRepository.save({
      ...loaded!,
      times: [
        { id: 't1', time: '08:00', amount: '1 capsule', label: 'Breakfast meds' },
        { id: 't2', time: '22:00', amount: '1 capsule', label: 'Before bed' },
      ],
      updatedAt: '2026-10-02T00:00:00.000Z',
    });

    const reloaded = scheduleRepository.getById(scheduleId);
    expect(reloaded?.times.map((t) => t.label)).toEqual(['Breakfast meds', 'Before bed']);
    expect(scheduleRepository.getAll().filter((s) => s.id === scheduleId)).toHaveLength(1);
  });

  it('preserves historical doses when a dose is deleted from the schedule', () => {
    const scheduleId = 'sched_amox_del';
    const initialSchedule: ReminderSchedule = {
      id: scheduleId,
      medicineId: 'med_test_1',
      recurrence: 'daily',
      startDate: '2026-01-01',
      times: [
        { id: 't1', time: '08:00', amount: '1 capsule' },
        { id: 't2', time: '14:00', amount: '1 capsule' },
        { id: 't3', time: '20:00', amount: '1 capsule' },
      ],
      enabled: true,
      notificationsEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    scheduleRepository.save(initialSchedule);

    // Log all 3 doses on 2026-01-10
    adherenceRepository.logDoseStatus(scheduleId, 'med_test_1', '2026-01-10', '08:00', 'taken');
    adherenceRepository.logDoseStatus(scheduleId, 'med_test_1', '2026-01-10', '14:00', 'taken');
    adherenceRepository.logDoseStatus(scheduleId, 'med_test_1', '2026-01-10', '20:00', 'taken');

    // Doctor reduces dosage: 14:00 dose is deleted from the schedule
    const updatedSchedule: ReminderSchedule = {
      ...initialSchedule,
      times: [
        { id: 't1', time: '08:00', amount: '1 capsule' },
        { id: 't3', time: '20:00', amount: '1 capsule' },
      ],
      updatedAt: '2026-02-01T12:00:00.000Z',
    };
    scheduleRepository.save(updatedSchedule);

    // Historical date (2026-01-10) must STILL have 3 doses and retain the 14:00 taken log
    const pastDoses = adherenceRepository.getDosesForDate('2026-01-10');
    expect(pastDoses).toHaveLength(3);
    expect(pastDoses.map((d) => d.time)).toEqual(['08:00', '14:00', '20:00']);
    expect(pastDoses.every((d) => d.status === 'taken')).toBe(true);

    const pastSummary = adherenceRepository.getDayAdherenceSummary('2026-01-10');
    expect(pastSummary.total).toBe(3);
    expect(pastSummary.taken).toBe(3);
    expect(pastSummary.percentage).toBe(100);

    // Future date reflects only the remaining 2 doses
    const futureDoses = adherenceRepository.getDosesForDate('2026-12-15');
    expect(futureDoses).toHaveLength(2);
    expect(futureDoses.map((d) => d.time)).toEqual(['08:00', '20:00']);
  });

  it('preserves past adherence history when recurrence changes', () => {
    const scheduleId = 'sched_amox_rec';
    // Daily schedule starting 2026-01-01
    const initialSchedule: ReminderSchedule = {
      id: scheduleId,
      medicineId: 'med_test_1',
      recurrence: 'daily',
      startDate: '2026-01-01',
      times: [{ id: 't1', time: '09:00', amount: '1 capsule' }],
      enabled: true,
      notificationsEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    scheduleRepository.save(initialSchedule);

    // 2026-01-06 was a Tuesday. User took their dose.
    adherenceRepository.logDoseStatus(scheduleId, 'med_test_1', '2026-01-06', '09:00', 'taken');

    // User switches to weekly schedule on Mondays (starting 2026-02-02)
    const updatedSchedule: ReminderSchedule = {
      ...initialSchedule,
      recurrence: 'weekly',
      startDate: '2026-02-02', // Monday
      updatedAt: '2026-02-02T08:00:00.000Z',
    };
    scheduleRepository.save(updatedSchedule);

    // Historical Tuesday (2026-01-06) must NOT be wiped by the new weekly recurrence
    const tuesdayDoses = adherenceRepository.getDosesForDate('2026-01-06');
    expect(tuesdayDoses).toHaveLength(1);
    expect(tuesdayDoses[0].time).toBe('09:00');
    expect(tuesdayDoses[0].status).toBe('taken');

    const tuesdaySummary = adherenceRepository.getDayAdherenceSummary('2026-01-06');
    expect(tuesdaySummary.total).toBe(1);
    expect(tuesdaySummary.taken).toBe(1);
    expect(tuesdaySummary.percentage).toBe(100);

    // Future Tuesday under weekly Monday recurrence is not scheduled
    const futureTuesdayDoses = adherenceRepository.getDosesForDate('2026-12-15');
    expect(futureTuesdayDoses).toHaveLength(0);
  });

  it('preserves historical adherence logs when a schedule is deleted', () => {
    const scheduleId = 'sched_amox_remove';
    const schedule: ReminderSchedule = {
      id: scheduleId,
      medicineId: 'med_test_1',
      recurrence: 'daily',
      startDate: '2026-01-01',
      times: [{ id: 't1', time: '08:00', amount: '1 capsule' }],
      enabled: true,
      notificationsEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    scheduleRepository.save(schedule);

    // Log dose on 2026-01-10
    adherenceRepository.logDoseStatus(scheduleId, 'med_test_1', '2026-01-10', '08:00', 'taken');

    // Patient finished course and deletes reminder schedule
    const deleted = scheduleRepository.delete(scheduleId);
    expect(deleted).toBe(true);

    // Active schedule is gone
    expect(scheduleRepository.getById(scheduleId)).toBeNull();

    // But past adherence logs and summaries for 2026-01-10 are preserved
    const pastDoses = adherenceRepository.getDosesForDate('2026-01-10');
    expect(pastDoses).toHaveLength(1);
    expect(pastDoses[0].time).toBe('08:00');
    expect(pastDoses[0].status).toBe('taken');

    const pastSummary = adherenceRepository.getDayAdherenceSummary('2026-01-10');
    expect(pastSummary.total).toBe(1);
    expect(pastSummary.taken).toBe(1);
    expect(pastSummary.percentage).toBe(100);

    // Future date has no doses
    const futureDoses = adherenceRepository.getDosesForDate('2026-12-15');
    expect(futureDoses).toHaveLength(0);
  });
});
