import { Router } from "express";
import { collections } from "../config/db";
import { verifyToken, verifyCustomer, verifyTechnician } from "../middleware/auth";
import { asyncHandler, HttpError, str, toObjectId } from "../utils/http";
import { ACTIVE_STATUSES, BOOKING_STATUSES, TECH_TRANSITIONS } from "../utils/constants";

const router = Router();

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * POST /api/bookings - customer sends a repair request.
 * Rules: service must be approved & available, no self-booking, preferred date
 * today or later, problem ≥ 20 chars, and no duplicate active request.
 */
router.post(
  "/",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const { services, bookings } = await collections();
    const body = req.body || {};
    const serviceId = str(body.serviceId);
    const customerPhone = str(body.customerPhone);
    const address = str(body.address);
    const problemDescription = str(body.problemDescription);
    const preferredDate = new Date(str(body.preferredDate));

    if (!/^[+\d][\d\s-]{6,}$/.test(customerPhone)) throw new HttpError(400, "A valid phone number is required");
    if (address.length < 5) throw new HttpError(400, "Address is required");
    if (problemDescription.length < 20) throw new HttpError(400, "Problem description must be at least 20 characters");
    if (isNaN(preferredDate.getTime()) || preferredDate < startOfToday()) {
      throw new HttpError(400, "Preferred date must be today or a future date");
    }

    const service = await services.findOne({ _id: toObjectId(serviceId) });
    if (!service || service.approvalStatus !== "approved" || !service.isAvailable) {
      throw new HttpError(404, "This service is not available");
    }
    if (service.technicianEmail === req.user!.email) throw new HttpError(403, "You cannot request your own service");

    const duplicate = await bookings.findOne({
      serviceId,
      customerEmail: req.user!.email,
      status: { $in: ACTIVE_STATUSES },
    });
    if (duplicate) throw new HttpError(409, "You already have an active request for this service");

    const now = new Date();
    const doc = {
      serviceId,
      serviceTitle: service.title,
      serviceImage: service.image,
      category: service.category,
      basePrice: service.basePrice,
      technicianName: service.technicianName,
      technicianEmail: service.technicianEmail,
      customerName: req.user!.name,
      customerEmail: req.user!.email,
      customerPhone,
      address,
      preferredDate,
      problemDescription,
      status: "requested",
      finalAmount: service.basePrice,
      paymentStatus: "unpaid",
      statusHistory: [{ status: "requested", changedAt: now }],
      createdAt: now,
    };
    const result = await bookings.insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  })
);

/** GET /api/bookings/my - the logged-in customer's own bookings only. */
router.get(
  "/my",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const { bookings } = await collections();
    const items = await bookings.find({ customerEmail: req.user!.email }).sort({ createdAt: -1 }).toArray();
    res.json(items);
  })
);

/** PATCH /api/bookings/:id/cancel - owner can cancel only while 'requested'. */
router.patch(
  "/:id/cancel",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const { bookings } = await collections();
    const _id = toObjectId(String(req.params.id));
    const booking = await bookings.findOne({ _id });
    if (!booking) throw new HttpError(404, "Booking not found");
    if (booking.customerEmail !== req.user!.email) throw new HttpError(403, "Forbidden: not your booking");
    if (booking.status !== "requested") throw new HttpError(400, "Only a requested job can be cancelled");

    const now = new Date();
    // status condition in the filter prevents a race with the technician
    const result = await bookings.findOneAndUpdate(
      { _id, status: "requested" },
      { $set: { status: "cancelled" }, $push: { statusHistory: { status: "cancelled", changedAt: now } } as never },
      { returnDocument: "after" }
    );
    if (!result) throw new HttpError(409, "The job status changed, please refresh");
    res.json(result);
  })
);

/** PATCH /api/bookings/:id/review - customer rates a paid booking (1-5) once. */
router.patch(
  "/:id/review",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const { bookings } = await collections();
    const _id = toObjectId(String(req.params.id));
    const rating = Number(req.body?.rating);
    const review = str(req.body?.review).slice(0, 500);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, "Rating must be 1 to 5");

    const booking = await bookings.findOne({ _id });
    if (!booking) throw new HttpError(404, "Booking not found");
    if (booking.customerEmail !== req.user!.email) throw new HttpError(403, "Forbidden: not your booking");
    if (booking.paymentStatus !== "paid") throw new HttpError(400, "You can review a job only after paying for it");
    if (booking.rating) throw new HttpError(409, "You already reviewed this job");

    const result = await bookings.findOneAndUpdate(
      { _id },
      { $set: { rating, review, reviewedAt: new Date() } },
      { returnDocument: "after" }
    );
    res.json(result);
  })
);

/** GET /api/bookings/technician - jobs assigned to the logged-in technician. */
router.get(
  "/technician",
  verifyToken,
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const { bookings } = await collections();
    const status = str(req.query.status);
    const filter: Record<string, unknown> = { technicianEmail: req.user!.email };
    if (status && status !== "all") {
      if (!BOOKING_STATUSES.includes(status as never)) throw new HttpError(400, "Invalid status filter");
      filter.status = status;
    }
    const items = await bookings.find(filter).sort({ createdAt: -1 }).toArray();
    res.json(items);
  })
);

/**
 * PATCH /api/bookings/:id/status - server-enforced job pipeline (Challenge 3).
 * Only the owning technician; only allowed transitions; completing needs finalAmount > 0.
 */
router.patch(
  "/:id/status",
  verifyToken,
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const { bookings } = await collections();
    const _id = toObjectId(String(req.params.id));
    const next = str(req.body?.status);
    const booking = await bookings.findOne({ _id });
    if (!booking) throw new HttpError(404, "Booking not found");
    if (booking.technicianEmail !== req.user!.email) throw new HttpError(403, "Forbidden: this job is not assigned to you");

    const allowed = TECH_TRANSITIONS[booking.status] || [];
    if (!allowed.includes(next as never)) {
      throw new HttpError(400, `Cannot change status from '${booking.status}' to '${next || "?"}'`);
    }

    const set: Record<string, unknown> = { status: next };
    if (next === "completed") {
      const finalAmount = Number(req.body?.finalAmount);
      if (!Number.isFinite(finalAmount) || finalAmount <= 0) throw new HttpError(400, "Final amount must be a number greater than 0");
      set.finalAmount = Math.round(finalAmount * 100) / 100;
      set.completedAt = new Date();
    }

    const result = await bookings.findOneAndUpdate(
      { _id, status: booking.status },
      { $set: set, $push: { statusHistory: { status: next, changedAt: new Date() } } as never },
      { returnDocument: "after" }
    );
    if (!result) throw new HttpError(409, "The job status changed, please refresh");
    res.json(result);
  })
);

export default router;
