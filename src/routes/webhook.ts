import { Router, raw } from "express";
import Stripe from "stripe";
import { recordPayment, stripe } from "../utils/payments";

const router = Router();

/**
 * POST /api/payments/webhook - Challenge 4.
 * Needs the raw body for signature verification, so it is mounted BEFORE
 * express.json(). Uses the same idempotent recordPayment() as the success page.
 */
router.post("/", raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return res.status(400).send("Missing signature or webhook secret");

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(req.body, signature, secret);
  } catch (err) {
    console.error("Webhook signature verification failed", err);
    return res.status(400).send("Invalid signature");
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object as Stripe.Checkout.Session;
      await recordPayment(session);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handling failed", err);
    // 500 lets Stripe retry later; recordPayment is idempotent
    res.status(500).json({ received: false });
  }
});

export default router;
