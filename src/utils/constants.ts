export const CATEGORIES = [
  "Smartphone",
  "Laptop & PC",
  "AC",
  "Refrigerator",
  "TV",
  "Washing Machine",
  "Electrical",
] as const;

export const SERVICE_MODES = ["Home Visit", "Shop Drop-off"] as const;

export const BOOKING_STATUSES = ["requested", "accepted", "rejected", "in-progress", "completed", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const ACTIVE_STATUSES: BookingStatus[] = ["requested", "accepted", "in-progress"];

/**
 * Allowed technician transitions. Anything not listed here is rejected by the
 * server (e.g. requested → completed, or touching a cancelled job).
 */
export const TECH_TRANSITIONS: Record<string, BookingStatus[]> = {
  requested: ["accepted", "rejected"],
  accepted: ["in-progress"],
  "in-progress": ["completed"],
};

export function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
