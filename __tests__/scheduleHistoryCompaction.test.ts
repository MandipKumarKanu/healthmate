import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { getDatabase } from "../src/database/client";
import {
  MAX_HISTORY_ROWS_PER_SCHEDULE,
  scheduleRepository,
} from "../src/database/repositories/scheduleRepository";
import { medicineRepository } from "../src/database/repositories/medicineRepository";

const MEDICINE_ID = "med_history_compact";
const SCHED_A = "sched_history_compact_a";
const SCHED_CAP = "sched_history_compact_cap";
const SCHED_DELETE = "sched_history_compact_del";

const TIMES_A = JSON.stringify([
  { id: "t_a", time: "08:00", amount: "1 tablet" },
]);
const TIMES_B = JSON.stringify([
  { id: "t_b", time: "20:00", amount: "2 tablets" },
]);

function insertHistoryRow(
  rowId: string,
  scheduleId: string,
  startDate: string,
  endDate: string,
  timesJson: string,
  updatedAt: string,
): void {
  getDatabase().runSync(
    `INSERT OR REPLACE INTO schedule_history (
      id, schedule_id, medicine_id, recurrence, start_date, end_date,
      times_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      rowId,
      scheduleId,
      MEDICINE_ID,
      "daily",
      startDate,
      endDate,
      timesJson,
      updatedAt, // created_at
      updatedAt,
    ],
  );
}

function historyRowCount(scheduleId: string): number {
  return getDatabase().getAllSync(
    "SELECT * FROM schedule_history WHERE schedule_id = ?;",
    [scheduleId],
  ).length;
}

function makeMedicine() {
  return {
    id: MEDICINE_ID,
    name: "History Compaction Medicine",
    strength: "10 mg",
    dosageForm: "tablet" as const,
    category: "Generic",
    packageDetails: {},
    isSample: false,
  };
}

function makeSchedule(scheduleId: string) {
  const now = new Date().toISOString();
  return {
    id: scheduleId,
    medicineId: MEDICINE_ID,
    recurrence: "daily" as const,
    startDate: "2026-10-01",
    times: [{ id: "t_main", time: "09:00", amount: "1 tablet" }],
    enabled: true,
    notificationsEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
}

describe("Schedule history compaction", () => {
  beforeEach(() => {
    medicineRepository.create(makeMedicine());
  });

  afterEach(() => {
    for (const scheduleId of [SCHED_A, SCHED_CAP, SCHED_DELETE]) {
      scheduleRepository.delete(scheduleId);
    }
    medicineRepository.delete(MEDICINE_ID);
  });

  it("merges contiguous history versions with identical times into one segment", () => {
    insertHistoryRow(
      "hist_a_1",
      SCHED_A,
      "2026-01-01",
      "2026-01-10",
      TIMES_A,
      "2026-01-10T00:00:00.000Z",
    );
    insertHistoryRow(
      "hist_a_2",
      SCHED_A,
      "2026-01-11",
      "2026-01-20",
      TIMES_A,
      "2026-01-20T00:00:00.000Z",
    );

    scheduleRepository.compactScheduleHistory(SCHED_A);

    const rows = getDatabase().getAllSync<{
      id: string;
      start_date: string;
      end_date: string;
    }>("SELECT * FROM schedule_history WHERE schedule_id = ?;", [SCHED_A]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("hist_a_1");
    expect(rows[0]?.start_date).toBe("2026-01-01");
    expect(rows[0]?.end_date).toBe("2026-01-20");
  });

  it("keeps versions with different times separate even when dates touch", () => {
    insertHistoryRow(
      "hist_b_1",
      SCHED_A,
      "2026-01-01",
      "2026-01-10",
      TIMES_A,
      "2026-01-10T00:00:00.000Z",
    );
    insertHistoryRow(
      "hist_b_2",
      SCHED_A,
      "2026-01-11",
      "2026-01-20",
      TIMES_B,
      "2026-01-20T00:00:00.000Z",
    );

    scheduleRepository.compactScheduleHistory(SCHED_A);

    expect(historyRowCount(SCHED_A)).toBe(2);
  });

  it("caps runaway history at the limit, keeping only the newest versions", () => {
    const total = MAX_HISTORY_ROWS_PER_SCHEDULE + 3;
    for (let i = 1; i <= total; i++) {
      // Every version gets distinct times (no merging possible) and a
      // standalone day range, so the only reducer in play is the cap.
      const day = 10 + i;
      insertHistoryRow(
        `hist_cap_${i}`,
        SCHED_CAP,
        `2026-01-${String(day).padStart(2, "0")}`,
        `2026-01-${String(day).padStart(2, "0")}`,
        JSON.stringify([
          { id: `t_${i}`, time: `0${i % 10}:00`, amount: "1 tablet" },
        ]),
        `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
      );
    }

    scheduleRepository.compactScheduleHistory(SCHED_CAP);

    const rows = getDatabase().getAllSync<{ id: string }>(
      "SELECT * FROM schedule_history WHERE schedule_id = ?;",
      [SCHED_CAP],
    );
    const rowIds = rows.map((r) => r.id);
    expect(rows).toHaveLength(MAX_HISTORY_ROWS_PER_SCHEDULE);
    // The OLDEST versions (hist_cap_1..3) are dropped.
    expect(rowIds).not.toContain("hist_cap_1");
    expect(rowIds).not.toContain("hist_cap_2");
    expect(rowIds).not.toContain("hist_cap_3");
    expect(rowIds).toContain(`hist_cap_${total}`);
  });

  it("delete() archives and then compacts the removed schedule's history", () => {
    // delete() only operates on active schedules — create one first.
    scheduleRepository.save(makeSchedule(SCHED_DELETE));

    const total = MAX_HISTORY_ROWS_PER_SCHEDULE + 2;
    for (let i = 1; i <= total; i++) {
      const day = 10 + i;
      insertHistoryRow(
        `hist_del_${i}`,
        SCHED_DELETE,
        `2026-02-${String(day).padStart(2, "0")}`,
        `2026-02-${String(day).padStart(2, "0")}`,
        JSON.stringify([
          { id: `t_${i}`, time: `0${i % 10}:00`, amount: "1 tablet" },
        ]),
        `2026-02-${String(day).padStart(2, "0")}T00:00:00.000Z`,
      );
    }

    expect(scheduleRepository.delete(SCHED_DELETE)).toBe(true);
    expect(historyRowCount(SCHED_DELETE)).toBeLessThanOrEqual(
      MAX_HISTORY_ROWS_PER_SCHEDULE,
    );
  });
});
