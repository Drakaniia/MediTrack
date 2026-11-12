export const APP_NAME = "MediTract";

/**
 * The browser tab title: `<facility name> · MediTract` (just `MediTract` while
 * the facility is still called that, so the default is not "MediTract · MediTract").
 * The two pages without a signed-in user have their own titles.
 */
export function documentTitleFor(
  pathname: string,
  facilityName: string
): string {
  if (pathname === "/login") {
    return `Sign in · ${APP_NAME}`;
  }
  if (pathname === "/change-password") {
    return `Change password · ${APP_NAME}`;
  }
  const name = facilityName.trim();
  if (name === "" || name.toLowerCase() === APP_NAME.toLowerCase()) {
    return APP_NAME;
  }
  return `${name} · ${APP_NAME}`;
}
