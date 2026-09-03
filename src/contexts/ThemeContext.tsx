import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LightColors, DarkColors, type ThemeColors } from '../theme';
import StartupScreen from '../components/startup-screen';

type ThemeMode = 'light' | 'dark';
type ThemePreference = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = '@axonic_theme_preference';

interface ThemeContextValue {
  colors: ThemeColors;
  mode: ThemeMode;
  isDark: boolean;
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: LightColors,
  mode: 'light',
  isDark: false,
  preference: 'system',
  setPreference: () => {},
});

/** Reliable system scheme — Appearance.getColorScheme() is synchronous and
 *  always correct, unlike useColorScheme() which can return null before the
 *  native bridge initialises on New Architecture / Android. */
function useSystemScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>(
    () => Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setScheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, []);
  return scheme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useSystemScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [loaded, setLoaded] = useState(false);

  // Load saved preference on mount
  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setPreferenceState(saved);
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceState(pref);
    AsyncStorage.setItem(THEME_STORAGE_KEY, pref).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const resolvedMode: ThemeMode =
      preference === 'system' ? systemScheme : preference;
    return {
      colors: resolvedMode === 'dark' ? DarkColors : LightColors,
      mode: resolvedMode,
      isDark: resolvedMode === 'dark',
      preference,
      setPreference,
    };
  }, [systemScheme, preference, setPreference]);

  if (!loaded) return <StartupScreen />;

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Hook — returns { colors, mode, isDark, preference, setPreference } */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
