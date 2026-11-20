import { Router } from "express";
import { verifyToken } from "../middleware/auth";
import { asyncHandler, HttpError, str } from "../utils/http";

const router = Router();

/**
 * POST /api/upload - { image: <base64 or data URL> } → { url }.
 * Proxies the upload to ImgBB so the ImgBB API key stays on the server.
 */
router.post(
  "/",
  verifyToken,
  asyncHandler(async (req, res) => {
    const key = process.env.IMGBB_API_KEY;
    if (!key) throw new HttpError(500, "Image upload is not configured");
    const raw = str(req.body?.image);
    const base64 = raw.includes(",") ? raw.split(",")[1] : raw;
    if (!base64 || base64.length < 100) throw new HttpError(400, "Please choose an image file");
    if (base64.length > 9_000_000) throw new HttpError(400, "Image must be smaller than 6 MB");

    const form = new URLSearchParams();
    form.append("key", key);
    form.append("image", base64);
    const r = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: form });
    const data = (await r.json()) as { success?: boolean; data?: { display_url?: string; url?: string } };
    if (!r.ok || !data.success) throw new HttpError(502, "Image upload failed, please try again");
    res.json({ url: data.data?.display_url || data.data?.url });
  })
);

export default router;
