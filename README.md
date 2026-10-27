# HealthMate AI 💊

**HealthMate AI** is a medication management and medicine-label education mobile application built with **Expo SDK 58**, **React Native 0.88**, **Expo Router**, and on-device **SQLite** persistence.

The application faithfully reproduces the iOS-style reference design, offering a calm, minimal interface with floating docks, adherence tracking, medication schedules, camera-based OCR label scanning, and medication terminology education.

---

## 📱 Visual Reference & Key Features

1. **Dashboard & Daily Adherence (`/(tabs)/home`)**:
   - Time-based greeting with user profile name (`Alex`)
   - 3-day logging streak and AI Mode indicator
   - Real-time adherence card displaying taken/remaining/missed/skipped percentages derived from database records
   - Next-up dose card with quick "Mark as Taken" action
   - Today's chronological timeline with status badges
   - Quick shortcuts to Health Insights, Camera Scanner, and Calendar

2. **Calendar & Dose Schedule (`/(tabs)/calendar`)**:
   - Interactive monthly calendar with month navigation and reminder indicators
   - Daily adherence 4-column summary (Taken, Remaining, Missed, Skipped)
   - Dose cards with status badges (`Taken`, `Missed`, `Skipped`, `Upcoming`)
   - Quick compliance actions (`Mark Taken`, `Skip`, and options menu)

3. **Medicine Cabinet (`/(tabs)/medicines`)**:
   - Medication list with dosage forms, strength, generic category, expiry dates, and schedule indicators
   - Search by medicine name or active ingredient
   - Segmented filter controls: `All`, `Active`, `Expired`
   - Secondary filter pills: `With Reminders`, `Without Reminders`

4. **Medicine Details (`/medicines/[id]`)**:
   - Hero summary with example package tag and clinical safety disclaimers
   - Amber warning banner prioritizing prescribing instructions
   - Structured package specifications (Name, Strength, Dosage Form)
   - Educational sections: "What is it used for?", "How does it work?", "Common uses", "Important safety information", and "Common side effects"
   - Active schedule viewer with "Set Reminder" and "Add Dose" actions

5. **Camera Package Scanner & History (`/(tabs)/scan` & `/scan-history`)**:
   - Camera preview with frame alignment guides
   - Photo library picker fallback
   - Automated OCR parsing extracting Medicine Name, Strength, Dosage Form, Manufacturer, Batch, and Expiry Date
   - Human-in-the-loop review allowing corrections before adding to cabinet or saving to history

6. **AI Assistant (`/ai-assistant`)**:
   - Live answers via the Google Gemini API (`gemini-3.5-flash-lite`, with stable-model fallback), enabled by pasting your own Gemini API key into the in-app "Connect AI" dialog (stored on-device with `expo-secure-store`)
   - Suggested prompts for mg vs. mL, active ingredients, batch/lot numbers, and medicine storage
   - Clinical safety guardrails: a system prompt forbids personalized medical advice, and questions seeking it are refused with a pointer to the patient leaflet, pharmacist, or prescriber
   - Offline fallback: with no key or no network, a fixed terminology guide answers instead, with a banner stating which mode is active
   - Chat history persisted locally in `ai_conversations` / `ai_messages`

7. **Profile & Local Security (`/(tabs)/profile`)**:
   - User profile management with editable name
   - Toggles for In-App Reminders and AI Assistant
   - Privacy & User Data Isolation documentation
   - Full Medical Disclaimer
   - Data management: "Reset Sample Records" and destructive "Clear Personal Data" with confirmation dialogs

---

## 🛠 Technology Stack

- **Framework**: [Expo SDK 58](https://expo.dev) (Continuous Native Generation, React Native 0.88, React 19)
- **Navigation**: [Expo Router v58](https://docs.expo.dev/router/introduction/) (File-based routing)
- **Local Database**: [`expo-sqlite`](https://docs.expo.dev/versions/latest/sdk/sqlite/) (Structured SQLite with foreign key cascades)
- **Notifications**: [`expo-notifications`](https://docs.expo.dev/versions/latest/sdk/notifications/) (Daily local notification alarms)
- **Camera & Media**: [`expo-camera`](https://docs.expo.dev/versions/latest/sdk/camera/) & [`expo-image-picker`](https://docs.expo.dev/versions/latest/sdk/image-picker/)
- **Client State**: [`zustand`](https://github.com/pmndrs/zustand)
- **Icons**: `@expo/vector-icons` (Ionicons, MaterialCommunityIcons, Feather)
- **Styling**: React Native `StyleSheet.create()` with a shared color palette in `src/theme/colors.ts`

---

## 📂 Project Structure

```text
healthmate/
├── src/
│   ├── app/                           # Expo Router Screens & Layouts
│   │   ├── _layout.tsx                # Root stack layout & DB initialization
│   │   ├── index.tsx                  # Onboarding gatekeeper
│   │   ├── onboarding/index.tsx       # Welcome screen with name input
│   │   ├── (tabs)/                    # Floating dock tab bar screens
│   │   │   ├── _layout.tsx
│   │   │   ├── home.tsx
│   │   │   ├── calendar.tsx
│   │   │   ├── scan.tsx
│   │   │   ├── medicines.tsx
│   │   │   └── profile.tsx
│   │   ├── medicines/
│   │   │   ├── [id].tsx               # Medicine details & education
│   │   │   └── add.tsx                # Add medicine form
│   │   ├── reminders/
│   │   │   └── create.tsx             # Set reminder schedule
│   │   ├── scan-history/index.tsx     # Saved scan history
│   │   ├── ai-assistant/index.tsx     # Medication education assistant
│   │   ├── health-adherence/index.tsx # Detailed adherence metrics
│   │   └── settings/                  # Privacy, Disclaimer, and About
│   │
│   ├── components/ui/                 # Shared Reusable UI Components
│   │   ├── AppScreen.tsx
│   │   ├── AppHeader.tsx
│   │   ├── AppCard.tsx
│   │   ├── AppButton.tsx
│   │   ├── AppInput.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── MedicineIcon.tsx
│   │   ├── MedicineCard.tsx
│   │   ├── ReminderCard.tsx
│   │   ├── CalendarGrid.tsx
│   │   ├── DayAdherenceSummaryCard.tsx
│   │   ├── SectionHeader.tsx
│   │   ├── MedicalDisclaimer.tsx
│   │   ├── ConfirmDialog.tsx
│   │   └── CustomBottomTabBar.tsx
│   │
│   ├── database/                      # SQLite Persistence Layer
│   │   ├── client.ts                  # Database connection & reset
│   │   ├── schema.ts                  # SQL table creation
│   │   ├── seed.ts                    # Realistic sample data seeder
│   │   └── repositories/              # Modular repositories
│   │       ├── medicineRepository.ts
│   │       ├── scheduleRepository.ts
│   │       ├── adherenceRepository.ts
│   │       ├── scanHistoryRepository.ts
│   │       └── profileRepository.ts
│   │
│   ├── services/                      # Application Services
│   │   ├── notificationService.ts     # Local notification scheduling
│   │   └── ocrService.ts              # Medication package text extraction
│   │
│   ├── store/                         # Zustand State Stores
│   │   ├── appStore.ts
│   │   ├── medicineStore.ts
│   │   └── reminderStore.ts
│   │
│   └── theme/
│       ├── colors.ts                  # Shared application color palette
│       └── tokens.ts                  # Spacing, radius, typography, shadows
│   │
│   └── types/                         # Shared TypeScript Interfaces
│       └── index.ts
│
├── __tests__/                         # Jest Unit Tests
│   ├── adherence.test.ts
│   └── ocr.test.ts
│
├── package.json
├── tsconfig.json
└── eslint.config.js
```

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Metro Development Server
```bash
npm run start
```

### 3. Run on Target Platform
- **iOS Simulator**: `npm run ios` (macOS with Xcode required)
- **Android Emulator / Device**: `npm run android`
- **Web Browser**: `npm run web`

---

## 🧪 Quality Assurance & Diagnostics

Run all project validation suites:

```bash
# Typecheck
npx tsc --noEmit

# Lint
npm run lint

# Run Unit Tests
npm test

# Expo Dependency Diagnostics
npx expo-doctor
```

---

## 📦 Building & Releasing APK (CI/CD)

HealthMate includes an automated GitHub Actions workflow (`.github/workflows/release-apk.yml`) that builds, packages, and releases installable Android APKs.

### 1. Trigger via Git Tag (Automatic Release)
Pushing any version tag starting with `v` automatically kicks off a build and publishes a GitHub Release with the APK attached:

```bash
git tag v1.3.1
git push origin v1.3.1
```

### 2. Trigger Manually (GitHub Actions UI)
1. Navigate to the **Actions** tab in your GitHub repository.
2. Select **Build & Release Android APK** from the left sidebar.
3. Click **Run workflow**.
4. *(Optional)* Provide a custom tag name (e.g. `v1.3.1`) and release title.
5. Click **Run workflow**.

### 3. Output & Distribution
- **GitHub Releases**: Standalone installable APKs (`healthmate-v1.3.1-arm64-v8a.apk` and `healthmate-v1.3.1-armeabi-v7a.apk`) are automatically attached to the published GitHub Release with generated release notes.
- **Workflow Artifacts**: The APKs are also preserved as downloadable workflow artifacts (`healthmate-apk-arm64-v8a` and `healthmate-apk-armeabi-v7a`) in the Actions run summary page for 30 days.

---

## 🔒 Medical & Privacy Safety Notice

HealthMate AI is strictly an **educational and organizational tool**. It is not a diagnostic device, clinical decision system, or prescription dispensing service. All medication records remain stored on the local device.

