import { CalendarConfig } from './types.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMerge<T>(base: T, overrides: Partial<T>): T {
  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(overrides as Record<string, unknown>)) {
    const overrideValue = (overrides as Record<string, unknown>)[key];

    if (overrideValue === undefined) continue;

    const baseValue = result[key];

    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }

  return result as T;
}

export function mergeConfig(base: CalendarConfig, overrides: Partial<CalendarConfig>): CalendarConfig {
  return deepMerge(base, overrides);
}
