import { COLORS } from '@/lib/brand';

/** OAuth-only Clerk chrome — Park Bound palette on any remaining Clerk surfaces (ADR-0010). */
export const clerkAppearance = {
  layout: {
    socialButtonsVariant: 'blockButton',
    socialButtonsPlacement: 'top',
  },
  variables: {
    colorPrimary: COLORS.adventure,
    colorDanger: COLORS.signal,
    colorSuccess: COLORS.meadow,
    colorWarning: COLORS.sun,
    colorNeutral: COLORS.parkMidnight,
    colorText: COLORS.parkMidnight,
    colorTextSecondary: '#4A5E78',
    colorBackground: COLORS.trail,
    colorInputBackground: COLORS.sky,
    colorInputText: COLORS.parkMidnight,
    borderRadius: '14px',
    fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
    fontFamilyButtons: 'Plus Jakarta Sans, system-ui, sans-serif',
  },
  elements: {
    rootBox: { width: '100%', maxWidth: '420px' },
    card: {
      backgroundColor: COLORS.trail,
      boxShadow: '0 12px 40px rgba(16, 35, 63, 0.18)',
    },
    headerTitle: {
      fontFamily: 'Plus Jakarta Sans, system-ui, sans-serif',
      fontWeight: 800,
      color: COLORS.parkMidnight,
    },
    headerSubtitle: { color: '#4A5E78' },
    socialButtonsBlockButton: {
      borderRadius: '14px',
      border: '1px solid rgba(16, 35, 63, 0.12)',
      backgroundColor: COLORS.sky,
      color: COLORS.parkMidnight,
      height: '48px',
    },
    formFieldRow: { display: 'none' },
    dividerRow: { display: 'none' },
    formButtonPrimary: { display: 'none' },
    footerAction: { display: 'none' },
    identityPreviewEditButton: { display: 'none' },
  },
};
