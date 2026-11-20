import { Router } from "express";
import { collections } from "../config/db";
import { verifyToken } from "../middleware/auth";
import { asyncHandler, HttpError, str, toObjectId } from "../utils/http";

const router = Router();

/** GET /api/users/me - current user's profile. */
router.get(
  "/me",
  verifyToken,
  asyncHandler(async (req, res) => {
    const { users } = await collections();
    const user = await users.findOne(
      { _id: toObjectId(req.user!.id) },
      { projection: { name: 1, email: 1, image: 1, role: 1, phone: 1, area: 1, bio: 1, createdAt: 1 } }
    );
    res.json(user);
  })
);

/**
 * PATCH /api/users/profile - update name, phone, area, bio, image.
 * Email and role can never be changed here.
 */
router.patch(
  "/profile",
  verifyToken,
  asyncHandler(async (req, res) => {
    const { users } = await collections();
    const body = req.body || {};
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      const name = str(body.name);
      if (name.length < 2) throw new HttpError(400, "Name must be at least 2 characters");
      update.name = name;
    }
    if (body.image !== undefined) {
      const image = str(body.image);
      if (image && !/^https?:\/\//.test(image)) throw new HttpError(400, "Invalid image URL");
      update.image = image;
    }
    if (body.phone !== undefined) update.phone = str(body.phone).slice(0, 30);
    if (body.area !== undefined) update.area = str(body.area).slice(0, 80);
    if (body.bio !== undefined) update.bio = str(body.bio).slice(0, 500);

    const result = await users.findOneAndUpdate(
      { _id: toObjectId(req.user!.id) },
      { $set: update },
      { returnDocument: "after", projection: { name: 1, email: 1, image: 1, role: 1, phone: 1, area: 1, bio: 1 } }
    );
    if (!result) throw new HttpError(404, "User not found");

    // keep denormalised technician name on services in sync
    if (update.name && result.role === "technician") {
      const { services } = await collections();
      await services.updateMany({ technicianEmail: result.email }, { $set: { technicianName: update.name } });
    }
    res.json(result);
  })
);

export default router;
