import { Router } from "express";
import { Document } from "mongodb";
import { collections } from "../config/db";
import { verifyToken, verifyTechnician } from "../middleware/auth";
import { asyncHandler, HttpError, str, toObjectId } from "../utils/http";
import { CATEGORIES, SERVICE_MODES, escapeRegex } from "../utils/constants";

const router = Router();

const PUBLIC_FILTER = { approvalStatus: "approved", isAvailable: true };

/** Adds averageRating + reviewCount from paid, reviewed bookings. */
const ratingStages: Document[] = [
  { $addFields: { idStr: { $toString: "$_id" } } },
  {
    $lookup: {
      from: "bookings",
      let: { sid: "$idStr" },
      pipeline: [
        { $match: { $expr: { $eq: ["$serviceId", "$$sid"] }, rating: { $gte: 1 } } },
        { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
      ],
      as: "ratingInfo",
    },
  },
  {
    $addFields: {
      averageRating: { $round: [{ $ifNull: [{ $arrayElemAt: ["$ratingInfo.avg", 0] }, 0] }, 1] },
      reviewCount: { $ifNull: [{ $arrayElemAt: ["$ratingInfo.count", 0] }, 0] },
    },
  },
  { $project: { ratingInfo: 0, idStr: 0 } },
];

function validateService(body: Record<string, unknown>) {
  const data = {
    title: str(body.title),
    category: str(body.category),
    description: str(body.description),
    image: str(body.image),
    basePrice: Number(body.basePrice),
    estimatedDuration: str(body.estimatedDuration),
    serviceMode: str(body.serviceMode),
    serviceArea: str(body.serviceArea),
  };
  if (data.title.length < 3) throw new HttpError(400, "Title must be at least 3 characters");
  if (!CATEGORIES.includes(data.category as (typeof CATEGORIES)[number])) throw new HttpError(400, "Invalid category");
  if (data.description.length < 20) throw new HttpError(400, "Description must be at least 20 characters");
  if (!/^https?:\/\//.test(data.image)) throw new HttpError(400, "A service image is required");
  if (!Number.isFinite(data.basePrice) || data.basePrice <= 0) throw new HttpError(400, "Base price must be a positive number");
  if (!data.estimatedDuration) throw new HttpError(400, "Estimated duration is required");
  if (!SERVICE_MODES.includes(data.serviceMode as (typeof SERVICE_MODES)[number])) throw new HttpError(400, "Invalid service mode");
  if (!data.serviceArea) throw new HttpError(400, "Service area is required");
  return data;
}

/**
 * GET /api/services - public. Search, filter, sort and paginate in MongoDB.
 * ?search=&category=&mode=&sort=price_asc|price_desc|newest&page=1&limit=8
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { services } = await collections();
    const search = str(req.query.search);
    const category = str(req.query.category);
    const mode = str(req.query.mode);
    const sortKey = str(req.query.sort) || "newest";
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(24, Math.max(1, parseInt(String(req.query.limit || "8"), 10) || 8));

    const match: Document = { ...PUBLIC_FILTER };
    if (category && category !== "all") match.category = category;
    if (mode && mode !== "any") match.serviceMode = mode;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      match.$or = [{ title: rx }, { category: rx }];
    }
    const sort: Document =
      sortKey === "price_asc" ? { basePrice: 1, createdAt: -1 } : sortKey === "price_desc" ? { basePrice: -1, createdAt: -1 } : { createdAt: -1 };

    const [total, items] = await Promise.all([
      services.countDocuments(match),
      services
        .aggregate([{ $match: match }, { $sort: sort }, { $skip: (page - 1) * limit }, { $limit: limit }, ...ratingStages])
        .toArray(),
    ]);
    res.json({ services: items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
  })
);

/** GET /api/services/featured - 6 latest approved & available. */
router.get(
  "/featured",
  asyncHandler(async (_req, res) => {
    const { services } = await collections();
    const items = await services
      .aggregate([{ $match: PUBLIC_FILTER }, { $sort: { createdAt: -1 } }, { $limit: 6 }, ...ratingStages])
      .toArray();
    res.json(items);
  })
);

/** GET /api/services/categories/counts - number of public services per category. */
router.get(
  "/categories/counts",
  asyncHandler(async (_req, res) => {
    const { services } = await collections();
    const rows = await services.aggregate([{ $match: PUBLIC_FILTER }, { $group: { _id: "$category", count: { $sum: 1 } } }]).toArray();
    const counts: Record<string, number> = {};
    for (const c of CATEGORIES) counts[c] = 0;
    for (const r of rows) counts[r._id] = r.count;
    res.json(counts);
  })
);

/** GET /api/services/mine - technician's own services (any status). */
router.get(
  "/mine",
  verifyToken,
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const { services } = await collections();
    const items = await services.find({ technicianEmail: req.user!.email }).sort({ createdAt: -1 }).toArray();
    res.json(items);
  })
);

/** GET /api/services/:id - public; only approved & available services are shown. */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { services, users, bookings } = await collections();
    const _id = toObjectId(String(req.params.id));
    const [service] = await services.aggregate([{ $match: { _id, ...PUBLIC_FILTER } }, ...ratingStages]).toArray();
    if (!service) throw new HttpError(404, "Service not found");

    const tech = await users.findOne(
      { email: service.technicianEmail },
      { projection: { name: 1, image: 1, area: 1, bio: 1, email: 1 } }
    );
    const reviews = await bookings
      .find({ serviceId: String(_id), rating: { $gte: 1 } }, { projection: { customerName: 1, rating: 1, review: 1, reviewedAt: 1 } })
      .sort({ reviewedAt: -1 })
      .limit(10)
      .toArray();
    res.json({ ...service, technician: tech || { name: service.technicianName, email: service.technicianEmail }, reviews });
  })
);

/** POST /api/services - technician adds a service (pending until approved). */
router.post(
  "/",
  verifyToken,
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const { services } = await collections();
    const data = validateService(req.body || {});
    const doc = {
      ...data,
      technicianName: req.user!.name,
      technicianEmail: req.user!.email,
      approvalStatus: "pending",
      isAvailable: true,
      createdAt: new Date(),
    };
    const result = await services.insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  })
);

/** PATCH /api/services/:id - owner edits; approval goes back to pending. */
router.patch(
  "/:id",
  verifyToken,
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const { services } = await collections();
    const _id = toObjectId(String(req.params.id));
    const existing = await services.findOne({ _id });
    if (!existing) throw new HttpError(404, "Service not found");
    if (existing.technicianEmail !== req.user!.email) throw new HttpError(403, "Forbidden: not your service");

    const body = req.body || {};
    // Availability-only toggle keeps the approval status
    if (Object.keys(body).length === 1 && typeof body.isAvailable === "boolean") {
      await services.updateOne({ _id }, { $set: { isAvailable: body.isAvailable } });
      return res.json({ ...existing, isAvailable: body.isAvailable });
    }

    const data = validateService({ ...existing, ...body });
    const update = { ...data, approvalStatus: "pending", updatedAt: new Date() };
    await services.updateOne({ _id }, { $set: update });
    res.json({ ...existing, ...update });
  })
);

/** DELETE /api/services/:id - owner deletes. */
router.delete(
  "/:id",
  verifyToken,
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const { services } = await collections();
    const _id = toObjectId(String(req.params.id));
    const existing = await services.findOne({ _id });
    if (!existing) throw new HttpError(404, "Service not found");
    if (existing.technicianEmail !== req.user!.email) throw new HttpError(403, "Forbidden: not your service");
    await services.deleteOne({ _id });
    res.json({ deleted: true });
  })
);

export default router;
