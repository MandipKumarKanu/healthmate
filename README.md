<p align="center">
  <img src="assets/images/android-icon-monochrome.png" alt="HealthMate Icon" height="120" />
</p>

# HealthMate

HealthMate is an offline-first medication management, adherence tracking, and pharmaceutical education mobile application built with React Native and Expo. It delivers native-grade reliability for dose alerts, on-device SQLite persistence, optical character recognition for medication packaging, and integrated AI-assisted medication guidance.

<p align="center">
  <img src="https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white" alt="Expo" />
  <img src="https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React Native" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Android-34A853?style=for-the-badge&logo=android&logoColor=white" alt="Android" />
  <img src="https://img.shields.io/badge/Google_Gemini-886FBF?style=for-the-badge&logo=googlegemini&logoColor=white" alt="Google Gemini" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="License: MIT" />
</p>

---

## Core Capabilities

### 1. Reliable Medication Scheduling and Alarms
- **Native Android Alarm Architecture**: Utilizes Android AlarmManager exact alarms paired with foreground services to ensure alarms fire reliably, even in deep doze mode or across device reboots.
- **Full-Screen Lockscreen Alerts**: Displays an authoritative incoming dose screen with audible ringing, haptic feedback, snooze controls, and one-tap dose confirmation.
- **Flexible Recurrence Patterns**: Supports daily, interval-based, specific days of the week, and custom monthly schedules.
- **Deduplication and Conflict Prevention**: Normalizes schedules and dose instances to prevent redundant alerts and synchronizes native alarm chains with the local database.

### 2. Medication Cabinet and Inventory
- **Comprehensive Profiles**: Tracks medication brand names, generic formulations, strengths, dosage forms, manufacturer details, batch numbers, and expiry dates.
- **Cabinet Filtering and Search**: Fast full-text lookup across active ingredients and brand names, with segmented filters for active medications, expired inventory, and schedules.
- **Safety and Usage Information**: Includes structured pharmaceutical details covering common indications, mechanisms of action, safety advisories, and known adverse effects.

### 3. Interactive Adherence and Timeline
- **Daily Dashboard**: Real-time adherence metric cards displaying completed, pending, skipped, and missed percentages computed directly from SQLite records.
- **Chronological Timeline**: Step-by-step visual tracker of daily dose events with immediate status updates.
- **Calendar History**: Monthly calendar grid highlighting dose density and providing drill-down summaries for historical compliance analysis.

### 4. Packaging Scanner and OCR Recognition
- **Camera and Image Processing**: Integrated camera capture with manual crop adjustment, contrast enhancement, and noise reduction.
- **Entity Extraction**: Recognizes medication labels to extract brand names, generic salts, strengths, batch identifiers, and expiration dates.
- **Human-in-the-Loop Review**: Allows users to inspect, verify, and correct recognized fields prior to saving records to the cabinet or scan log.

### 5. Pharmaceutical AI Assistant
- **On-Device Key Management**: Integrates Google Gemini models using API keys stored securely in hardware-backed device storage (Expo SecureStore).
- **Clinical Safety Guardrails**: Enforces structured system prompts that restrict output to educational information, explicitly prohibiting personalized medical diagnosis and directing clinical queries to licensed professionals.
- **Offline Fallback Knowledge Base**: Automatically switches to an embedded offline pharmaceutical reference when network connectivity or API credentials are unavailable.

### 6. Privacy and Data Governance
- **Zero Remote Telemetry**: All health data, schedules, scan archives, and adherence histories remain exclusively on the local device.
- **Backup and Restore**: Local export and import routines allow users to create encrypted snapshots of their data without cloud dependency.
- **Complete Erasure**: One-tap data reset permanently clears database tables, cached media, and stored credentials.

---

## Technical Stack

| Component | Technology | Version | Description |
| :--- | :--- | :--- | :--- |
| Core Framework | Expo | 58.x | Managed native workflows with Continuous Native Generation |
| Runtime | React Native | 0.88.x | Modern mobile architecture with React 19 |
| Routing | Expo Router | 58.x | Typed file-based routing and navigation layouts |
| Database | Expo SQLite | 58.x | Structured relational persistence with schema migrations |
| Native Background | Android AlarmManager | Native Module | Exact alarms, full-screen intents, and foreground services |
| State Management | Zustand | 5.x | Lightweight, reactive client-side state stores |
| Security | Expo SecureStore | 58.x | Keychain / Keystore hardware-backed secret storage |
| Media and Sensors | Expo Camera / ImagePicker | 58.x | On-device photo capture and gallery asset access |
| Testing Suite | Jest / Ts-Jest | 30.x / 29.x | Comprehensive unit and integration test framework |

---

## Project Structure

```text
healthmate/
├── android/                         # Generated native Android project
├── assets/                          # Static branding, images, and fonts
├── src/
│   ├── app/                         # Application routes and navigation screens
│   │   ├── (tabs)/                  # Main floating-dock tab views
│   │   │   ├── calendar.tsx         # Adherence calendar and historical logs
│   │   │   ├── home.tsx             # Daily summary, timeline, and quick actions
│   │   │   ├── medicines.tsx        # Medication cabinet and search
│   │   │   ├── profile.tsx          # Account settings and system health
│   │   │   └── scan.tsx             # Camera-based packaging scanner
│   │   ├── ai-assistant/            # Educational assistant interface
│   │   ├── health-adherence/        # Compliance analysis metrics
│   │   ├── medicines/               # Medication creation and detail views
│   │   ├── onboarding/              # First-run setup and permissions walkthrough
│   │   ├── reminders/               # Schedule creation and recurrence settings
│   │   ├── scan-history/            # Optical recognition scan logs
│   │   ├── settings/                # Disclaimers, battery optimization, backups
│   │   ├── alarm.tsx                # Full-screen incoming medication alarm
│   │   └── _layout.tsx              # Root initialization and database startup
│   ├── components/                  # Domain and reusable visual components
│   │   ├── ai/                      # Assistant chat and modal dialogs
│   │   ├── home/                    # Timeline cards and daily metric widgets
│   │   ├── profile/                 # Alarm reliability and diagnostics cards
│   │   ├── scan/                    # Crop overlay and OCR progress views
│   │   └── ui/                      # Base buttons, dialogs, cards, and inputs
│   ├── database/                    # Persistence layer
│   │   ├── migrationManager.ts      # Transactional SQLite schema migrations
│   │   ├── schema.ts                # Table definitions and constraints
│   │   ├── seed.ts                  # Development and demonstration dataset
│   │   └── repositories/            # Domain-specific data access objects
│   ├── hooks/                       # Custom React lifecycle and layout hooks
│   ├── services/                    # Background and system integration services
│   │   ├── aiAssistantService.ts    # Gemini API client and offline fallback
│   │   ├── backupService.ts         # Encrypted JSON data import and export
│   │   ├── nativeAlarmService.ts    # Android exact alarms and ringtone triggers
│   │   ├── notificationService.ts   # Local notification manager
│   │   └── remoteOcrService.ts      # Multi-stage image OCR parser
│   ├── store/                       # Zustand application state slices
│   ├── theme/                       # Color palettes, typography, and spacing tokens
│   ├── types/                       # Shared TypeScript interface definitions
│   └── utils/                       # Date calculation, validation, and math helpers
├── __tests__/                       # Automated test suites
├── app.json                         # Expo configuration and native plugin declarations
├── package.json                     # Dependency manifests and scripts
└── tsconfig.json                    # TypeScript compiler configuration
```

---

## Getting Started

### Prerequisites
- Node.js (v20 or v22 recommended)
- npm or bun package manager
- Android Studio with Android SDK 34+ (for Android builds) or Xcode (macOS only, for iOS builds)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy the example environment template and populate required service credentials:
```bash
cp .env.example .env
```

| Variable | Description | Requirement |
| :--- | :--- | :--- |
| `EXPO_PUBLIC_OCR_API_URL` | HTTPS endpoint of the RapidOCR parsing backend | Optional (defaults to mock/offline fallback) |
| `EXPO_PUBLIC_OCR_API_KEY` | Client access or proxy authentication token | Optional |
| `HEALTHMATE_RELEASE_KEYSTORE_BASE64` | Base64-encoded Android release keystore binary | Required for production release signing |
| `HEALTHMATE_RELEASE_KEY_ALIAS` | Key alias identifier inside the release keystore | Required for production release signing |
| `HEALTHMATE_RELEASE_KEY_PASSWORD` | Password protecting the private key alias | Required for production release signing |
| `HEALTHMATE_RELEASE_STORE_PASSWORD` | Password protecting the release keystore file | Required for production release signing |

### 3. Start the Metro Development Server
```bash
npx expo start
```

### 4. Launch on Target Platform
- **Android Device or Emulator**:
  ```bash
  npx expo run:android
  ```
- **iOS Simulator**:
  ```bash
  npx expo run:ios
  ```

---

## Quality Assurance and Testing

HealthMate maintains strict verification standards across static typing, style rules, and unit test coverage.

### TypeScript Compilation Check
Verify type soundness across the entire project:
```bash
npx tsc --noEmit
```

### Code Style and Linting
Enforce project standards with ESLint:
```bash
npm run lint
```

### Unit and Integration Tests
Execute Jest test suites covering adherence math, scheduling recurrence, database migrations, OCR extraction, and alarm chains:
```bash
npm test
```

### Expo Configuration Diagnostics
Validate dependency versions and native setup:
```bash
npx expo-doctor
```

---

## Medical and Privacy Disclaimer

HealthMate is designed solely as an informational, educational, and organizational utility. It is not a medical device, clinical diagnostic tool, decision support engine, or prescription dispensing service.

- Always verify medication packaging, dosage recommendations, and administration instructions with the printed manufacturer label and your prescribing physician or licensed pharmacist.
- HealthMate does not provide professional medical advice, diagnosis, or treatment. Never disregard or delay seeking clinical consultation because of content viewed within this application.
- All personal data, medication records, adherence logs, and scan images are stored locally on your device. The application does not collect, transmit, or monetize personal health information.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
