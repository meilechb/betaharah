# Google Cloud Console

One OAuth client serves two jobs. They use different redirect addresses and different scopes, so signing in does not grant access to a calendar, and connecting a calendar does not replace sign-in.

The client id and client secret are pasted into the operator console at https://betaharah.com/admin/ (Keys → Google). They are not Worker secrets.

## Consent screen

| Field | Value |
|---|---|
| User type | External |
| App name | Betaharah |
| Home page | `https://betaharah.com` |
| Privacy policy | `https://betaharah.com/privacy` |
| Terms of service | `https://betaharah.com/terms` |
| Publishing | In production. In Testing, Google ends access after seven days. |

Until Google verifies the app, people see an “unverified app” page and can continue past it. Google also caps an unverified app at 100 users.

## Scopes to add

Sign-in:

- `openid`
- `https://www.googleapis.com/auth/userinfo.email`
- `https://www.googleapis.com/auth/userinfo.profile`

The sign-in request sends these as the scope string `openid email profile`. Google returns the account’s subject id, verified email, and name. That is used only to recognize the person.

Calendar, and only when someone presses Connect Google Calendar:

- `https://www.googleapis.com/auth/calendar.app.created`

That scope lets the site create one calendar and manage events on calendars this app created. It cannot see any other calendar.

Enable the **Google Calendar API** on the project.

## Authorized redirect URIs

Create one OAuth client of type **Web application** and add both:

1. `https://betaharah.com/api/auth/google/callback` — Sign in with Google
2. `https://betaharah.com/api/google/callback` — Connect Google Calendar

No other redirect is used. The site is served only at `https://betaharah.com`.

## What is stored

The sign-in email and name are kept inside the account’s encrypted record. Google’s subject id is stored only as a keyed fingerprint, so the account can be found again. The calendar refresh token is inside the same encrypted record. Access tokens are used in memory and are not stored.
