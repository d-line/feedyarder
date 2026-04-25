import type { FetchStatus } from "./types.js";

const minimumIntervalMinutes = 60;
const inactiveIntervalMinutes = 360;
const maximumIntervalMinutes = 1_440;

interface ScheduleInput {
  currentIntervalMinutes: number;
  consecutiveErrorCount: number;
  newItemCount: number;
  status: FetchStatus;
}

export function calculateNextFetchIntervalMinutes({
  currentIntervalMinutes,
  consecutiveErrorCount,
  newItemCount,
  status
}: ScheduleInput): number {
  const current = Math.max(currentIntervalMinutes, minimumIntervalMinutes);

  if (status === "error") {
    const multiplier = consecutiveErrorCount >= 3 ? 2.5 : 2;
    return clampInterval(Math.ceil(current * multiplier));
  }

  if (status === "not_modified" || newItemCount === 0) {
    return clampInterval(current + 30);
  }

  return clampInterval(Math.max(minimumIntervalMinutes, Math.floor(current * 0.75)));
}

function clampInterval(value: number): number {
  return Math.min(Math.max(value, minimumIntervalMinutes), maximumIntervalMinutes);
}

export function classifyFeedActivity(
  currentIntervalMinutes: number,
  newItemCount: number
): "active" | "inactive" {
  if (newItemCount > 0) {
    return "active";
  }

  return currentIntervalMinutes >= inactiveIntervalMinutes ? "inactive" : "active";
}
