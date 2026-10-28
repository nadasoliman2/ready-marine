/*
 * Sign-in and sign-up: a page of their own, without the store's header, menu, footer, chat
 * and bottom bar (AppChrome leaves these paths alone — lib/dashboardRoute.js `isAuthPath`).
 * Each page draws its own background and card; the logo on the card leads back home.
 */
export default function AuthLayout({ children }) {
  return <main className="min-h-screen">{children}</main>;
}
