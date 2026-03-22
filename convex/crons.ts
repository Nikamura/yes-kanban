import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "auto-archive completed issues",
  { hours: 1 },
  internal.autoArchive.runAutoArchive
);

export default crons;
