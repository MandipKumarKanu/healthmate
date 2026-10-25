export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  screenPaddingHorizontal: 20,
  cardPadding: 16,
  sectionGap: 24,
} as const;

export const Radius = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  card: 20,
  pill: 9999,
} as const;

export const Typography = {
  displayLarge: {
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 38,
    color: '#111116',
  },
  displayMedium: {
    fontSize: 28,
    fontWeight: '700' as const,
    lineHeight: 34,
    color: '#111116',
  },
  heading1: {
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 30,
    color: '#111116',
  },
  heading2: {
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 26,
    color: '#111116',
  },
  heading3: {
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
    color: '#111116',
  },
  bodyLarge: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
    color: '#111116',
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
    color: '#111116',
  },
  bodySmall: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
    color: '#8A8991',
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
    color: '#8A8991',
  },
  badge: {
    fontSize: 12,
    fontWeight: '600' as const,
    lineHeight: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
  },
} as const;

export const Shadows = {
  none: {},
  subtle: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  floating: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
} as const;
