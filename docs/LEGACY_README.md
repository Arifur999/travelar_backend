# Travel Agency Management SaaS

Multi-tenant B2B travel agency management platform.

- `/server` — Node.js + Express + MongoDB (Mongoose) API
- `/client` — React (Vite) + Tailwind CSS frontend

## Setup

1. Copy environment files and fill in real values:
   ```
   server/.env.example -> server/.env
   client/.env.example -> client/.env
   ```
2. Install dependencies:
   ```
   cd server && npm install
   cd ../client && npm install
   ```
3. Make sure MongoDB is running and `MONGO_URI` in `server/.env` points to it.

## Running

```
cd server && npm run dev   # API on http://localhost:5000
cd client && npm run dev   # App on http://localhost:5173
```

## Seeding the Super Admin

The platform-level `super_admin` account isn't created through the normal signup flow (registration only ever creates an agency + `agency_admin`). Create it with the seed script instead:

```
cd server
npm run seed
```

This creates one `super_admin` user using these env vars from `server/.env` (falls back to the defaults shown if not set):

| Env var | Default |
|---|---|
| `SUPER_ADMIN_NAME` | `Super Admin` |
| `SUPER_ADMIN_EMAIL` | `admin@example.com` |
| `SUPER_ADMIN_PASSWORD` | `Admin@123` |

Running it again is safe — if a user with that email already exists, the script just logs that and exits without creating a duplicate.

Log in with those credentials at `/login`; a `super_admin` is redirected to `/admin/dashboard` instead of the regular agency dashboard.

## Trials

- A new agency starts with `status: "trial"` and `trialEndsAt` set to 7 days from registration.
- Once `trialEndsAt` passes and the agency hasn't been upgraded to `status: "active"`, tenant users (`agency_admin` / `agency_staff`) get read-only access: `GET` requests still work, but `POST`/`PUT`/`PATCH`/`DELETE` are blocked with a 403 until a super admin activates the agency (or it's reactivated via billing, once that exists).
