# FixMate - Server (API)

REST API for **FixMate**, a smart device & home appliance repair service platform.
Built with **Express 5 + TypeScript + MongoDB**, secured with **JWT + role-based middlewares**,
and **Stripe Checkout + Webhook** for pay-after-service payments.

- **Live API:** `https://<your-server>.vercel.app`
- **Client repo / live site:** see the client README

## Tech
| Area | Package |
|---|---|
| Server | `express`, `cors`, `dotenv` |
| Database | `mongodb` (native driver) |
| Auth | `jsonwebtoken` (verifies the JWT issued by the Next.js app) |
| Payments | `stripe` (Checkout Session, session retrieve, webhook signature) |
| Images | ImgBB REST API (proxied through `/api/upload`) |
| Dev | `typescript`, `tsx`, `@types/*` |

## Collections (4)
`user` (BetterAuth's user collection = our **users**), `services`, `bookings`, `payments`.
Indexes: `payments.stripeSessionId` (unique), `payments.bookingId` (unique), plus lookup indexes.

## Middlewares (Challenge 2)
- `verifyToken` - `Authorization: Bearer <jwt>` → 401 if missing/invalid; loads the user from DB (current role).
- `verifyCustomer`, `verifyTechnician`, `verifyAdmin` - 403 for the wrong role.
- Every query on private data uses the email from the token, never from the URL.

## API
| Method & route | Access |
|---|---|
| `GET /api/services` (search, category, mode, sort, page, limit) | Public |
| `GET /api/services/featured`, `GET /api/services/categories/counts` | Public |
| `GET /api/services/:id` | Public (approved & available only) |
| `GET /api/services/mine` | Technician |
| `POST /api/services`, `PATCH /api/services/:id`, `DELETE /api/services/:id` | Technician (owner) |
| `POST /api/bookings`, `GET /api/bookings/my`, `PATCH /api/bookings/:id/cancel` | Customer |
| `PATCH /api/bookings/:id/review` | Customer (paid booking) |
| `GET /api/bookings/technician`, `PATCH /api/bookings/:id/status` | Technician (owner) |
| `POST /api/payments/create-checkout-session`, `GET /api/payments/verify`, `GET /api/payments/my` | Customer |
| `POST /api/payments/webhook` | Stripe (signature) |
| `GET /api/admin/users`, `PATCH /api/admin/users/:id/role` | Admin |
| `GET /api/admin/services`, `PATCH /api/admin/services/:id/approval` | Admin |
| `GET /api/admin/bookings`, `GET /api/admin/payments` | Admin |
| `GET /api/stats/customer` · `/technician` · `/admin` | Matching role |
| `PATCH /api/users/profile`, `GET /api/users/me`, `POST /api/upload` | Logged-in |

## Job status pipeline (Challenge 3)
`requested → accepted | rejected` · `accepted → in-progress` · `in-progress → completed` (needs `finalAmount > 0`) - technician owner only.
`requested → cancelled` - customer owner only. Any other change returns **400**.
Payment only for a **completed + unpaid** booking owned by the logged-in customer; the amount is read from the DB.

## Payments (Challenge 4)
Success page (`/api/payments/verify`) and webhook (`checkout.session.completed`) both call one idempotent
`recordPayment()` (upsert on unique `stripeSessionId` + `paymentStatus: 'unpaid'` filter), so a payment is never saved twice.

## Run locally
```bash
cp .env.example .env   # fill in the values
npm install
npm run dev            # http://localhost:5000
```
Stripe webhook locally: `stripe listen --forward-to localhost:5000/api/payments/webhook`.

## Deploy (Vercel)
1. Import this repo in Vercel (framework: Other). `vercel.json` routes every path to `api/index.ts`.
2. Add all `.env` variables in Project → Settings → Environment Variables.
3. Add the production client URL to `CLIENT_URLS` and `CLIENT_URL`.
4. Stripe Dashboard (test mode) → Webhooks → endpoint `https://<server>/api/payments/webhook`,
   event `checkout.session.completed` → copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
