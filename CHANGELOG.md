# Changelog

All notable changes to HealthMate will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-11-01

### Added
- **Interactive Lockscreen Alarm**: Full-screen lockscreen reminder with sky-blue ambient radiating rings, radiating chime rays, and a prominent blue alarm icon badge.
- **Swipe-to-Action Gestures**: Physical `slide to mark as taken` gesture slider replacing flat buttons, featuring responsive spring physics and tactile haptic feedback.
- **Accidental Tap Safety System**: Tapping *Snooze 10m* or *Skip for now* transforms the main slider into a dedicated confirmation swipe (`slide to snooze 10m` / `slide to skip this dose`) with a `← Back to Take Dose` cancel option to prevent accidental skips.
- **Simultaneous Multi-Medicine Grouping**: Intelligent stacking when two or more medications are scheduled for the exact same minute, providing a single `slide to take all` action and individual per-dose status badges.
- **Per-Medicine Frequency Badges**: Explicit frequency indicators (`Daily`, `Weekly`, `Monthly`) on multi-dose cards for mixed routine accuracy.
- **RecurrenceScheduleModal**: Flexible scheduling engine supporting daily, weekly day-of-week selection, monthly, and interval-based reminders.
- **ChatGPT-Style Streaming AI**: Typewriter text streaming with a pulsing cursor and smooth pacing for Gemini AI consultations.
- **Structured Next Up Card**: Interactive bottom card displaying the next upcoming medication dose, time, and quantity with chevron navigation.

### Changed
- **Lockscreen Layout Refinement**: Eliminated dead space with structured medication rows (Frequency, Dosage Instructions with water/food, Doctor directions).
- **Camera Scanner Pipeline**: Reorganized scan review cards into a vertical stack for clearer packaging review; isolated interactive photo crop viewport from page scroll to eliminate gesture drag interference.
- **Instant Save Routing**: Saving a medication from camera scan navigates directly to Medicine Details without screen flash or redundant reminder prompts.
- **Native Platform Transitions**: Replaced JS-driven `slide_from_right` transitions with hardware-accelerated Android native predictive transitions (`animation: 'default'`) and fast modal fades (`180ms`).
- **Standardized 12-Hour Time**: Uniform 12-hour AM/PM time formatting across all Home and Calendar timeline components.
- **Apple Health-Style Schedule Cards**: Clean, modern medication detail view with line-by-line reminder cards and adherence tracking.

### Fixed
- **Schedule Edit Hydration**: Correctly re-hydrates existing times and dose amount when modifying saved schedules.
- **Duplicate Time Prevention**: Blocked duplicate time slot entries for the same medication.
- **AI Viewport Jump**: Automated response scrolling to focus cleanly on the top of newly arrived AI responses instead of disorienting bottom-jumps.
- **AI Deep-Link Race Conditions**: Eliminated initial state drops when opening the AI assistant with pre-filled packaging context.
- **New Architecture Layout Warning**: Silenced `setLayoutAnimationEnabledExperimental is currently a no-op` warning in React Native Fabric / Bridgeless mode.

### Performance
- **Slider Spring Snappiness**: Increased slider spring tension to `130` and friction to `8` for instantaneous tactile snap-back.
- **Exit Latency Reduction**: Slashed post-action departure delays (Take, Snooze, Skip) from `750ms` down to `200ms`.
- **Bundle & Memory Tuning**: Reconciled reminder synchronization in deferred background ticks to prevent foreground render competition.

---

## [1.0.0] - 2026-10-31

### Added
- Initial release of HealthMate.
- OCR camera package scanning and text extraction.
- Offline SQLite database layer for medications, schedules, adherence logs, and user profiles.
- Native Android foreground alarm service with full-screen lockscreen intent overlap.
- AI health assistant integration with Gemini API.
- Calendar adherence logging and monthly tracking.
- Secure local storage for personal preferences and API keys.

