/** Fields required to evaluate legal compliance. */
export type UserLegalSlice = {
  termsAcceptedAt: Date | null;
  privacyAcceptedAt: Date | null;
  legalVersion: string | null;
};
