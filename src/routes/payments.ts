import { Router } from "express";
import { collections } from "../config/db";
import { verifyToken, verifyCustomer } from "../middleware/auth";
import { asyncHandler, HttpError, str, toObjectId } from "../utils/http";
import { recordPayment, stripe } from "../utils/payments";

const router = Router();

/**
 * POST /api/payments/create-checkout-session - Challenge 3 payment gate.
 * The amount always comes from the database, never from the client.
 */
router.post(
  "/create-checkout-session",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const { bookings } = await collections();
    const _id = toObjectId(str(req.body?.bookingId));
    const booking = await bookings.findOne({ _id });
    if (!booking) throw new HttpError(404, "Booking not found");
    if (booking.customerEmail !== req.user!.email) throw new HttpError(403, "Forbidden: not your booking");
    if (booking.status !== "completed") throw new HttpError(400, "You can pay only after the job is completed");
    if (booking.paymentStatus !== "unpaid") throw new HttpError(409, "This booking is already paid");

    const amount = Number(booking.finalAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Invalid final amount");

    const clientUrl = (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "");
    const session = await stripe().checkout.sessions.create({
      mode: "payment",
      customer_email: booking.customerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: booking.serviceTitle,
              description: `FixMate repair by ${booking.technicianName}`,
              ...(booking.serviceImage ? { images: [booking.serviceImage] } : {}),
            },
          },
        },
      ],
      metadata: { bookingId: String(booking._id), customerEmail: booking.customerEmail },
      success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/payment/cancel`,
    });
    res.json({ url: session.url, id: session.id });
  })
);

/** GET /api/payments/verify?session_id= - used by the success page. */
router.get(
  "/verify",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const sessionId = str(req.query.session_id);
    if (!sessionId.startsWith("cs_")) throw new HttpError(400, "Invalid session id");
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.customerEmail !== req.user!.email) throw new HttpError(403, "Forbidden: not your payment");
    if (session.payment_status !== "paid") throw new HttpError(400, "Payment is not completed");
    const payment = await recordPayment(session);
    res.json(payment);
  })
);

/** GET /api/payments/my - payment history of the logged-in customer. */
router.get(
  "/my",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const { payments } = await collections();
    const items = await payments.find({ customerEmail: req.user!.email }).sort({ paidAt: -1 }).toArray();
    res.json(items);
  })
);

export default router;
