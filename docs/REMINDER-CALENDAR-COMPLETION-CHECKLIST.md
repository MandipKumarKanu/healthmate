# Reminder & Calendar Completion Checklist

Use this checklist as the release gate for PR #5. Do not check an item until its acceptance criteria are verified.

## Calendar behavior
- [x] Remove hardcoded reminder dots on dates 19 and later.
- [x] Parse YYYY-MM-DD as a local calendar date to avoid timezone shifts.
- [x] Build calendar dot dates from actual enabled schedules and/or actual dose records, not a decorative default.
- [ ] Tapping a date with reminders selects that date and shows only that date's reminders without navigating away.
- [ ] Tapping a date with no reminders opens Add Reminder with that date prefilled.
- [ ] Confirm changing month and tapping dates works across month/year boundaries and does not change the selected date unexpectedly.

## Reminder editor
- [x] Add medicine search to the medicine selector.
- [x] Add an editable label for each dose.
- [x] Add Reminder Times heading with Edit action, readable AM/PM time pills in view mode, dose rows, divider, and prominent Add Another Time control (final visual/device review still recommended).
- [ ] Provide editable time picker per dose and add/remove controls in Edit mode.
- [ ] Default dose labels by time: Morning (08:00), Afternoon (14:00), Evening (18:00), Night (22:00), while allowing custom labels.
- [ ] Persist labels and times through SQLite and show the label in scheduled notification content.
- [ ] Preserve existing schedules when editing; avoid accidental duplicate or lost dose entries.
- [ ] Search results include medicine name and strength; handle no results and empty medicine list.

## Android alarm and permissions
- [x] Request native notification permission when user saves an enabled reminder.
- [x] Request notification permission during onboarding/setup; onboarding continues if permission is denied. (A pre-prompt rationale screen can still improve clarity.)
- [x] Configure Android notification channel with high importance, sound, and vibration; add Expo Notifications config plugin.
- [ ] Verify exact-alarm access on Android 12+ and implement/verify the supported native settings flow. Runtime notification permission alone does not prove exact-time alarm access.
- [ ] Verify scheduled alarms survive app closure and reboot, and correctly reschedule/cancel when a schedule is edited/deleted.
- [ ] If Android blocks exact alarms or notifications, explain the limitation and provide a route to system settings; never claim an alarm is active when scheduling failed.

## Automated and device validation
- [ ] Add regression tests for false calendar dots and date routing/selection.
- [ ] Add tests for dose label defaults, custom labels, and schedule persistence.
- [ ] TypeScript passes.
- [ ] Unit tests pass.
- [ ] Lint passes.
- [ ] Expo Doctor passes or any exception is documented with a technical reason.
- [ ] Android APK build succeeds from this branch.
- [ ] Install and test on a physical Android device: first-run permissions, notification delivery, sound/vibration, exact timing, app closed, reboot, edit, and delete flows.

## Release gate
- [ ] All applicable checklist items above are complete or explicitly documented as device-only checks.
- [ ] Review final diff and CI results.
- [ ] Only then mark PR ready for review; do not merge while alarm behavior is unverified.
