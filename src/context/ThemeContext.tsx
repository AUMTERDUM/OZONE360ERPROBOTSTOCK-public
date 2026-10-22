import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type ThemeId = 'ozone360' | 'ocean' | 'forest' | 'purple' | 'rose' | 'slate' | 'dark';

export interface Theme {
  id: ThemeId;
  name: string;
  accent: string;
  sidebar: string;
}

export const THEMES: Theme[] = [
  { id: 'ozone360', name: 'OZONE360',  accent: '#f97316', sidebar: '#1e3a8a' },
  { id: 'ocean',    name: 'มหาสมุทร',  accent: '#0891b2', sidebar: '#0f4c5c' },
  { id: 'forest',   name: 'ป่าไม้',    accent: '#16a34a', sidebar: '#14532d' },
  { id: 'purple',   name: 'ม่วง',      accent: '#7c3aed', sidebar: '#3730a3' },
  { id: 'rose',     name: 'กุหลาบ',    accent: '#e11d48', sidebar: '#881337' },
  { id: 'slate',    name: 'เทาหิน',    accent: '#0f172a', sidebar: '#0f172a' },
  { id: 'dark',     name: 'มืด',       accent: '#f97316', sidebar: '#0a1628' },
];

const STORAGE_KEY = 'erp_theme';

interface ThemeContextType {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    return stored || 'ozone360';
  } catch {
    return 'ozone360';
  }
}

function persistTheme(themeId: ThemeId) {
  try {
    localStorage.setItem(STORAGE_KEY, themeId);
  } catch {
    // Ignore storage failures so the app can still render.
  }
}

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [themeId, setThemeId] = useState<ThemeId>(readStoredTheme);

  useEffect(() => {
    if (themeId === 'ozone360') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', themeId);
    }
    persistTheme(themeId);
  }, [themeId]);

  return (
    <ThemeContext.Provider value={{ themeId, setTheme: setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};
