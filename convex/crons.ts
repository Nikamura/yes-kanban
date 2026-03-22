import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "cleanup old webhook deliveries",
  { hourUTC: 3, minuteUTC: 0 },
  internal.webhooks.cleanupOldDeliveries
);

crons.interval(
  "auto-archive completed issues",
  { hours: 1 },
  internal.autoArchive.runAutoArchive
);

export default crons;
