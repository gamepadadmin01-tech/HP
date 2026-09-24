import { getSession } from './account';
import { createWebsiteLogin } from '../api/account';

export const WEBSITE_ACCOUNT = 'https://www.gamepad.space/account';

export async function websitePlansUrl(): Promise<string> {
  const session = getSession();
  if (!session) return WEBSITE_ACCOUNT;
  const result = await createWebsiteLogin(session.token);
  if (getSession()?.token !== session.token) throw new Error('Your account changed. Please try again.');
  if (!/^[a-f0-9]{64}$/.test(result.code)) throw new Error('Website sign-in is unavailable.');
  // Only a one-use 60-second grant enters the URL, never the app session token.
  return `${WEBSITE_ACCOUNT}#app_login=${result.code}`;
}
