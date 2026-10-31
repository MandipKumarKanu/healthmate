# Reminder & Calendar Completion Checklist

Use this checklist as the release gate for PR #5. Do not check an item until its acceptance criteria are verified.

Verification pass: 2026-10-26. Local checks: `npx tsc --noEmit` (0 errors), `npx jest --silent` (18 suites / 185 tests green), `npx expo lint` (clean), `npx expo-doctor` (20/20 checks passed). Boxes that need a physical Android device or CI are marked **[device-only]** / **[CI-only]** and stay unchecked here on purpose.

## Calendar behavior

- [x] Remove hardcoded reminder dots on dates 19 and later.
- [x] Parse YYYY-MM-DD as a local calendar date to avoid timezone shifts.
- [x] Build calendar dot dates from actual enabled schedules and/or actual dose records, not a decorative default.
- [x] Tapping a date with reminders selects that date and shows only that date's reminders without navigating away. (`onSelectDate` only calls `setSelectedDate`; the dose list is driven by `loadDosesForDate(selectedDate)`. Routing decision covered by `getDateTapAction` tests in `calendarConsistency.test.ts`.)
- [x] Tapping a date with no reminders opens Add Reminder with that date prefilled. (`calendar.tsx` → `handleSelectDate` routes via `getDateTapAction`, pushing `/reminders/create` with `params.date`; the editor prefills `startDate` from the `date` param. Unit-tested.)
- [x] Confirm changing month and tapping dates works across month/year boundaries and does not change the selected date unexpectedly. (Code-verified: month arrows mutate view state only, so they cannot change `selectedDate`; `CalendarGrid` now re-syncs the visible month when `selectedDate` changes from outside. Selection is set only by day-cell taps. Visual confirmation still belongs in the device pass below.)

## Reminder editor

- [x] Add medicine search to the medicine selector.
- [x] Add an editable label for each dose.
- [x] Add Reminder Times heading with Edit action, readable AM/PM time pills in view mode, dose rows, divider, and prominent Add Another Time control (final visual/device review still recommended).
- [x] Provide editable time picker per dose and add/remove controls in Edit mode. (Android native `DateTimePickerAndroid`, iOS/web modal fallback, per-row trash control, "Pick Time & Add Dose" button in `reminders/create.tsx`.)
- [x] Default dose labels by time: Morning (08:00), Afternoon (14:00), Evening (18:00), Night (22:00), while allowing custom labels. (`getTimeLabel` anchors unit-tested at all four checklist times in `reminderValidation.test.ts`; label field is free-text in Edit mode.)
- [x] Persist labels and times through SQLite and show the label in scheduled notification content. (Times+labels round-trip via `times_json` — test in `scheduleEditsAdherence.test.ts`; notification body renders `` `${doseLabel} · Scheduled dose: ${amount}` `` and the native alarm chain receives `label`.)
- [x] Preserve existing schedules when editing; avoid accidental duplicate or lost dose entries. (Same-id `INSERT OR REPLACE` + `schedule_history` archiving; covered by `scheduleEditsAdherence.test.ts`.)
- [x] Search results include medicine name and strength; handle no results and empty medicine list. (Search filters name+strength+category and rows render `strength · dosageForm`; dedicated no-match and empty-cabinet states with an "Add Medicine" action.)

## Android alarm and permissions

- [x] Request native notification permission when user saves an enabled reminder.
- [x] Request notification permission during onboarding/setup; onboarding continues if permission is denied. (A pre-prompt rationale screen can still improve clarity.)
- [x] Configure Android notification channel with high importance, sound, and vibration; add Expo Notifications config plugin.
- [x] Verify exact-alarm access on Android 12+ and implement/verify the supported native settings flow. Runtime notification permission alone does not prove exact-time alarm access. (Native `AlarmModule.canScheduleExactAlarms()` → `AlarmManager.canScheduleExactAlarms()`, checked before scheduling in `notificationService`, in onboarding, and surfaced with a system-settings route in Settings → battery-optimization and `AlarmReliabilityCard`; true/false paths unit-tested in `batteryOptimization.test.ts`.)
- [ ] **[device-only]** Verify scheduled alarms survive app closure and reboot, and correctly reschedule/cancel when a schedule is edited/deleted. Code is complete: the `BOOT_COMPLETED` receiver now re-arms the full native alarm chain (`AlarmArming.kt`), and edit/delete cancel + reconcile through `notificationService` (unit-tested in `alarmLifecycle`, `alarmTriggerWindow`, `scheduleEditsAdherence`). Do not check until the physical-device reboot pass runs.
- [x] If Android blocks exact alarms or notifications, explain the limitation and provide a route to system settings; never claim an alarm is active when scheduling failed. (`handleSave` shows a "Schedule saved without alarms" alert with the exact Settings path when `saveSchedule` returns false; success copy is conditional on granted access; `scheduleDoseReminder` gates on `canScheduleExactAlarms`.)

## Automated and device validation

- [x] Add regression tests for false calendar dots and date routing/selection. (`calendarConsistency.test.ts`: dot consistency incl. clamping/disabled schedules + `getDateTapAction` routing.)
- [x] Add tests for dose label defaults, custom labels, and schedule persistence.
- [x] TypeScript passes. (`npx tsc --noEmit`, 0 errors, 2026-10-26)
- [x] Unit tests pass. (18 suites / 185 tests, 2026-10-26)
- [x] Lint passes. (`npx expo lint`, 2026-10-26)
- [x] Expo Doctor passes or any exception is documented with a technical reason. (20/20 checks passed, 2026-10-26)
- [ ] **[CI-only]** Android APK build succeeds from this branch. (Verify the `android-ci` workflow run on this commit; no local Android SDK here.)
- [ ] **[device-only]** Install and test on a physical Android device: first-run permissions, notification delivery, sound/vibration, exact timing, app closed, reboot, edit, and delete flows.

## Release gate

- [ ] All applicable checklist items above are complete or explicitly documented as device-only checks. (Two device-only/CI-only items remain open above; this gate stays open until they land.)
- [ ] Review final diff and CI results.
- [ ] Only then mark PR ready for review; do not merge while alarm behavior is unverified.
