# FixMate - Server (REST API)

The backend for **FixMate**, a repair booking platform where customers book verified technicians and
pay only after the job is done. Built with **Express 5, TypeScript and MongoDB**, protected with
**JWT and role-based middlewares**, with **Stripe Checkout + Webhook** for payments.

| | |
|---|---|
| **Live API** | https://fixmate-server-rho.vercel.app |
| **Live site** | https://fixmate-client-xi.vercel.app |
| **Client repo** | https://github.com/ifahimhasan/fixmate-client |

Quick check: `GET /` returns `{"name":"FixMate API","status":"ok"}`.

---

## Admin & demo accounts

| Role | Email | Password |
|---|---|---|
| **Admin** | `admin@fixmate.com` | `Admin@123` |
| Technician | `tanvir@fixmate.com` | `Tech@123` |
| Customer | `nabila@fixmate.com` | `Customer@123` |

Accounts and demo data are created by `npm run seed` in the client repo.

---

## Features

- **4 collections:** `user` (BetterAuth's user collection), `services`, `bookings`, `payments`
- **JWT auth:** the Next.js app issues a token, the API verifies it and reloads the user's current role from the database
- **Role middlewares:** `verifyToken` (401), `verifyCustomer`, `verifyTechnician`, `verifyAdmin` (403)
- **Own data only:** every private query uses the email from the token, never from the URL
- **Server-side search, filter, sort and pagination** with MongoDB `.skip()` and `.limit()`
- **Job status rules** enforced on the server, invalid changes return 400
- **Pay after service:** checkout only for completed and unpaid bookings, amount always read from the database
- **Idempotent payments:** the success page and the webhook share one function, unique indexes stop duplicates
- **ImgBB upload proxy**, so the API key never reaches the browser
- **Central error handling** (400 bad JSON, 403 blocked origin, 404 unknown route, 413 large body)
- **CORS allow-list** from environment variables

---

## API routes

| Method & route | Access |
|---|---|
| `GET /api/services` (search, category, mode, sort, page, limit) | Public |
| `GET /api/services/featured` | Public |
| `GET /api/services/categories/counts` | Public |
| `GET /api/services/:id` | Public (approved & available only) |
| `GET /api/services/mine` | Technician |
| `POST /api/services` | Technician |
| `PATCH /api/services/:id`, `DELETE /api/services/:id` | Technician (owner) |
| `POST /api/bookings` | Customer |
| `GET /api/bookings/my` | Customer |
| `PATCH /api/bookings/:id/cancel` | Customer (owner) |
| `PATCH /api/bookings/:id/review` | Customer (paid booking) |
| `GET /api/bookings/technician` | Technician |
| `PATCH /api/bookings/:id/status` | Technician (owner) |
| `POST /api/payments/create-checkout-session` | Customer |
| `GET /api/payments/verify` | Customer |
| `GET /api/payments/my` | Customer |
| `POST /api/payments/webhook` | Stripe (signature verified) |
| `GET /api/admin/users` | Admin |
| `PATCH /api/admin/users/:id/role` | Admin (not own role) |
| `GET /api/admin/services` | Admin |
| `PATCH /api/admin/services/:id/approval` | Admin |
| `GET /api/admin/bookings` | Admin |
| `GET /api/admin/payments` | Admin |
| `GET /api/stats/customer`, `/technician`, `/admin` | Matching role |
| `GET /api/users/me`, `PATCH /api/users/profile` | Logged in |
| `POST /api/upload` | Logged in |

---

## Job status flow

```
requested → accepted → in-progress → completed   (status)
requested → rejected    (technician)
requested → cancelled   (customer)
completed + payment     → paymentStatus: paid
```

- Only the technician who owns the service can accept, reject, start and complete a job.
- Completing a job needs a `finalAmount` greater than 0.
- Only the customer who made the request can cancel it, and only while it is requested.
- Payment is allowed only for a completed and unpaid booking owned by the logged-in customer.

## Payments

1. The client asks for a Checkout Session. The server reads the amount from the database and creates it.
2. After payment, Stripe sends the customer to `/payment/success`, which calls `/api/payments/verify`.
3. Stripe also calls `/api/payments/webhook` with `checkout.session.completed`.
4. Both paths use one `recordPayment()` function with an upsert and unique indexes on
   `stripeSessionId` and `bookingId`, so a payment is never saved twice.

---

## npm packages

| Package | Used for |
|---|---|
| `express` | Server and routing |
| `cors` | Allowed client origins |
| `dotenv` | Loading environment variables |
| `mongodb` | Native MongoDB driver |
| `jsonwebtoken` | Verifying the JWT from the client |
| `stripe` | Checkout Session, session verify, webhook signature |
| `typescript`, `tsx`, `@types/*` (dev) | TypeScript build and dev server |

## Environment variables

Create `.env` from `.env.example`:

| Variable | Description |
|---|---|
| `PORT` | Local port (`5000`) |
| `MONGODB_URI` | MongoDB connection string |
| `DB_NAME` | Database name (`fixmate`) |
| `JWT_SECRET` | Must be the same as the client's `JWT_SECRET` |
| `CLIENT_URLS` | Allowed origins, comma separated |
| `CLIENT_URL` | Client URL for Stripe success / cancel redirects |
| `STRIPE_SECRET_KEY` | Stripe test secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`) |
| `IMGBB_API_KEY` | ImgBB API key |

## Run locally

```bash
git clone https://github.com/ifahimhasan/fixmate-server.git
cd fixmate-server
npm install
cp .env.example .env   # fill in the values
npm run dev            # http://localhost:5000
```

## Deploy (Vercel)

- Framework preset: **Other**. `vercel.json` sends every request to `api/index.ts`.
- The empty `public/` folder is needed by Vercel as the static output folder.
- Add every variable from `.env` in the Vercel project settings, then redeploy.
- Stripe webhook endpoint: `https://fixmate-server-rho.vercel.app/api/payments/webhook`
  with the `checkout.session.completed` event.
