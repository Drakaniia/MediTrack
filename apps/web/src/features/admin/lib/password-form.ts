import { MIN_PASSWORD_LENGTH, passwordSchema } from "@shared/session";

export interface PasswordFormValues {
  confirmPassword: string;
  currentPassword: string;
  newPassword: string;
}

export type PasswordFormErrors = Partial<
  Record<keyof PasswordFormValues, string>
>;

export const EMPTY_PASSWORD_FORM: PasswordFormValues = {
  confirmPassword: "",
  currentPassword: "",
  newPassword: "",
};

export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

/** Submit-time checks for the change-password form (spec §7.4: nothing is flagged while typing). */
export function validatePasswordForm(
  values: PasswordFormValues
): PasswordFormErrors {
  const errors: PasswordFormErrors = {};
  if (values.currentPassword === "") {
    errors.currentPassword = "Enter your current password.";
  }
  const strength = passwordSchema.safeParse(values.newPassword);
  if (!strength.success) {
    errors.newPassword =
      values.newPassword === ""
        ? "Enter a new password."
        : (strength.error.issues[0]?.message ?? "Choose a different password.");
  } else if (values.newPassword === values.currentPassword) {
    errors.newPassword = "Choose a password you haven't used before.";
  }
  if (values.confirmPassword !== values.newPassword) {
    errors.confirmPassword = "The passwords don't match.";
  }
  return errors;
}
