import { Router } from "express";
import { collections } from "../config/db";
import { verifyToken, verifyAdmin } from "../middleware/auth";
import { asyncHandler, HttpError, str, toObjectId } from "../utils/http";
import { BOOKING_STATUSES } from "../utils/constants";

const router = Router();
router.use(verifyToken, verifyAdmin);

/** GET /api/admin/users - every user (safe fields only). */
router.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const { users } = await collections();
    const items = await users
      .find({}, { projection: { name: 1, email: 1, image: 1, role: 1, phone: 1, area: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(items);
  })
);

/** PATCH /api/admin/users/:id/role - change a user's role (never your own). */
router.patch(
  "/users/:id/role",
  asyncHandler(async (req, res) => {
    const { users } = await collections();
    const role = str(req.body?.role);
    if (!["customer", "technician", "admin"].includes(role)) throw new HttpError(400, "Invalid role");
    const _id = toObjectId(String(req.params.id));
    const target = await users.findOne({ _id });
    if (!target) throw new HttpError(404, "User not found");
    if (target.email === req.user!.email) throw new HttpError(403, "You cannot change your own role");
    await users.updateOne({ _id }, { $set: { role, updatedAt: new Date() } });
    res.json({ ...target, role });
  })
);

/** GET /api/admin/services?status=pending - all services, pending first. */
router.get(
  "/services",
  asyncHandler(async (req, res) => {
    const { services } = await collections();
    const status = str(req.query.status);
    const match: Record<string, unknown> = {};
    if (["pending", "approved", "rejected"].includes(status)) match.approvalStatus = status;
    const items = await services
      .aggregate([
        { $match: match },
        { $addFields: { order: { $indexOfArray: [["pending", "approved", "rejected"], "$approvalStatus"] } } },
        { $sort: { order: 1, createdAt: -1 } },
        { $project: { order: 0 } },
      ])
      .toArray();
    res.json(items);
  })
);

/** PATCH /api/admin/services/:id/approval - approve or reject. */
router.patch(
  "/services/:id/approval",
  asyncHandler(async (req, res) => {
    const { services } = await collections();
    const approvalStatus = str(req.body?.approvalStatus);
    if (!["approved", "rejected"].includes(approvalStatus)) throw new HttpError(400, "approvalStatus must be approved or rejected");
    const _id = toObjectId(String(req.params.id));
    const result = await services.findOneAndUpdate(
      { _id },
      { $set: { approvalStatus, reviewedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!result) throw new HttpError(404, "Service not found");
    res.json(result);
  })
);

/** GET /api/admin/bookings?status= - read-only list of every booking. */
router.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const { bookings } = await collections();
    const status = str(req.query.status);
    const filter: Record<string, unknown> = {};
    if (status && status !== "all") {
      if (!BOOKING_STATUSES.includes(status as never)) throw new HttpError(400, "Invalid status filter");
      filter.status = status;
    }
    res.json(await bookings.find(filter).sort({ createdAt: -1 }).toArray());
  })
);

/** GET /api/admin/payments - every payment + total revenue. */
router.get(
  "/payments",
  asyncHandler(async (_req, res) => {
    const { payments } = await collections();
    const items = await payments.find({}).sort({ paidAt: -1 }).toArray();
    const totalRevenue = items.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    res.json({ payments: items, totalRevenue: Math.round(totalRevenue * 100) / 100, count: items.length });
  })
);

export default router;
