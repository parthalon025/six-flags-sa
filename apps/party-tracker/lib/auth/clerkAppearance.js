/** OAuth-only Clerk chrome — no email, password, or magic-link fields (ADR-0010). */
export const clerkAppearance = {
  layout: {
    socialButtonsVariant: 'blockButton',
    socialButtonsPlacement: 'top',
  },
  elements: {
    formFieldRow: { display: 'none' },
    dividerRow: { display: 'none' },
    formButtonPrimary: { display: 'none' },
    footerAction: { display: 'none' },
    identityPreviewEditButton: { display: 'none' },
  },
};
