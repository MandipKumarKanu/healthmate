import { create } from 'zustand';
import { Medicine } from '../types';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
import { notificationService } from '../services/notificationService';

interface MedicineState {
  medicines: Medicine[];
  searchQuery: string;
  expiryFilter: 'all' | 'active' | 'expired';
  reminderFilter: 'all' | 'with' | 'without';
  loadMedicines: () => void;
  setSearchQuery: (q: string) => void;
  setExpiryFilter: (f: 'all' | 'active' | 'expired') => void;
  setReminderFilter: (f: 'all' | 'with' | 'without') => void;
  addMedicine: (med: Omit<Medicine, 'createdAt' | 'updatedAt'>) => Medicine;
  updateMedicine: (id: string, updates: Partial<Medicine>) => void;
  deleteMedicine: (id: string) => Promise<boolean>;
}

export const useMedicineStore = create<MedicineState>((set, get) => ({
  medicines: [],
  searchQuery: '',
  expiryFilter: 'all',
  reminderFilter: 'all',

  loadMedicines: () => {
    const { searchQuery, expiryFilter, reminderFilter } = get();
    const list = medicineRepository.search(searchQuery, expiryFilter, reminderFilter);
    set({ medicines: list });
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
    get().loadMedicines();
  },

  setExpiryFilter: (filter: 'all' | 'active' | 'expired') => {
    set({ expiryFilter: filter });
    get().loadMedicines();
  },

  setReminderFilter: (filter: 'all' | 'with' | 'without') => {
    set({ reminderFilter: filter });
    get().loadMedicines();
  },

  addMedicine: (med) => {
    const created = medicineRepository.create(med);
    get().loadMedicines();
    return created;
  },

  updateMedicine: (id: string, updates: Partial<Medicine>) => {
    medicineRepository.update(id, updates);
    get().loadMedicines();
  },

  deleteMedicine: async (id: string) => {
    const existing = medicineRepository.getById(id);
    if (!existing) return false;

    // Remove pending OS notifications before deleting the schedule records.
    const schedules = scheduleRepository.getAll().filter((schedule) => schedule.medicineId === id);
    for (const schedule of schedules) {
      await notificationService.cancelForSchedule(schedule.id);
    }

    const deleted = medicineRepository.delete(id);
    if (deleted) get().loadMedicines();
    return deleted;
  },
}));
