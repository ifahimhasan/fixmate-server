import { Router } from "express";
import { Document } from "mongodb";
import { collections } from "../config/db";
import { verifyToken, verifyCustomer, verifyTechnician, verifyAdmin } from "../middleware/auth";
import { asyncHandler } from "../utils/http";

const router = Router();

/** Last 6 calendar months as { key: 'YYYY-MM', label: 'Jun' } */
function lastSixMonths() {
  const out: { key: string; label: string }[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({
      key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`,
      label: m.toLocaleString("en-US", { month: "short" }),
    });
  }
  return out;
}

async function monthlyRevenue(match: Document) {
  const { payments } = await collections();
  const months = lastSixMonths();
  const rows = await payments
    .aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidAt" } }, total: { $sum: "$amount" } } },
    ])
    .toArray();
  const map = new Map(rows.map((r) => [r._id, r.total]));
  return months.map((m) => ({ month: m.label, amount: Math.round((map.get(m.key) || 0) * 100) / 100 }));
}

async function statusCounts(match: Document) {
  const { bookings } = await collections();
  const rows = await bookings.aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray();
  const counts: Record<string, number> = { requested: 0, accepted: 0, "in-progress": 0, completed: 0, rejected: 0, cancelled: 0 };
  for (const r of rows) counts[r._id] = r.count;
  return counts;
}

/** GET /api/stats/customer - overview cards + status chart. */
router.get(
  "/customer",
  verifyToken,
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const email = req.user!.email;
    const counts = await statusCounts({ customerEmail: email });
    const { payments } = await collections();
    const paid = await payments.aggregate([{ $match: { customerEmail: email } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray();
    res.json({
      totalRequests: Object.values(counts).reduce((a, b) => a + b, 0),
      activeJobs: counts.requested + counts.accepted + counts["in-progress"],
      completedJobs: counts.completed,
      totalSpent: paid[0]?.total || 0,
      statusCounts: counts,
      monthlySpending: await monthlyRevenue({ customerEmail: email }),
    });
  })
);

/** GET /api/stats/technician - overview cards + earnings chart. */
router.get(
  "/technician",
  verifyToken,
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const email = req.user!.email;
    const { services, payments } = await collections();
    const [totalServices, approvedServices, counts, earned] = await Promise.all([
      services.countDocuments({ technicianEmail: email }),
      services.countDocuments({ technicianEmail: email, approvalStatus: "approved" }),
      statusCounts({ technicianEmail: email }),
      payments.aggregate([{ $match: { technicianEmail: email } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
    ]);
    res.json({
      totalServices,
      approvedServices,
      pendingRequests: counts.requested,
      totalEarnings: earned[0]?.total || 0,
      statusCounts: counts,
      monthlyEarnings: await monthlyRevenue({ technicianEmail: email }),
    });
  })
);

/** GET /api/stats/admin - platform overview + charts. */
router.get(
  "/admin",
  verifyToken,
  verifyAdmin,
  asyncHandler(async (_req, res) => {
    const { users, services, bookings, payments } = await collections();
    const [totalUsers, totalTechnicians, pendingServices, totalBookings, revenue, byCategory, counts] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ role: "technician" }),
      services.countDocuments({ approvalStatus: "pending" }),
      bookings.countDocuments({}),
      payments.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
      bookings.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray(),
      statusCounts({}),
    ]);
    res.json({
      totalUsers,
      totalTechnicians,
      pendingServices,
      totalBookings,
      totalRevenue: revenue[0]?.total || 0,
      bookingsByCategory: byCategory.map((c) => ({ category: c._id, count: c.count })),
      statusCounts: counts,
      monthlyRevenue: await monthlyRevenue({}),
    });
  })
);

export default router;
