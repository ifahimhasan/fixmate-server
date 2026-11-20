import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { collections } from "../config/db";

let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

/**
 * Save a paid Checkout Session exactly once. Called from both the success-page
 * verification and the webhook. The unique indexes on stripeSessionId and
 * bookingId plus the upsert with $setOnInsert make it idempotent, so Stripe
 * retries or a double call never create a second payment.
 */
export async function recordPayment(session: Stripe.Checkout.Session) {
  const { payments, bookings } = await collections();
  const bookingId = session.metadata?.bookingId;
  if (!bookingId || !ObjectId.isValid(bookingId)) throw new Error("Session has no bookingId");
  if (session.payment_status !== "paid") return null;

  const booking = await bookings.findOne({ _id: new ObjectId(bookingId) });
  if (!booking) throw new Error("Booking not found for session");

  const transactionId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || session.id;

  const doc = {
    bookingId,
    serviceTitle: booking.serviceTitle,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    technicianName: booking.technicianName,
    technicianEmail: booking.technicianEmail,
    amount: (session.amount_total ?? Math.round(booking.finalAmount * 100)) / 100,
    currency: session.currency || "usd",
    transactionId,
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  try {
    await payments.updateOne({ stripeSessionId: session.id }, { $setOnInsert: doc }, { upsert: true });
  } catch (err: unknown) {
    // E11000 = another request inserted it at the same moment - that's fine
    if (!(err && typeof err === "object" && "code" in err && (err as { code: number }).code === 11000)) throw err;
  }

  // Mark the booking paid only once (filter on unpaid)
  await bookings.updateOne(
    { _id: booking._id, paymentStatus: "unpaid" },
    {
      $set: { paymentStatus: "paid", paidAt: new Date() },
      $push: { statusHistory: { status: "paid", changedAt: new Date() } } as never,
    }
  );

  return payments.findOne({ stripeSessionId: session.id });
}
