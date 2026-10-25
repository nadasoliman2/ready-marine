const DEFAULT_BANNER_LIMIT = 25;
const DEFAULT_SHIFT_MINUTES = 60;

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Split banners into balanced shifts and select the shift active at `now`.
 * Round-robin distribution keeps newer/older records spread between shifts,
 * while the absolute time slot makes every server instance return the same
 * shift without storing mutable scheduling state.
 */
function selectBannerShift(candidates = [], options = {}) {
  const limit = Math.min(
    toPositiveInteger(options.limit, DEFAULT_BANNER_LIMIT),
    DEFAULT_BANNER_LIMIT
  );
  const shiftMinutes = toPositiveInteger(options.shiftMinutes, DEFAULT_SHIFT_MINUTES);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const nowMs = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const shiftDurationMs = shiftMinutes * 60 * 1000;
  const shiftCount = Math.max(1, Math.ceil(candidates.length / limit));
  const shifts = Array.from({ length: shiftCount }, () => []);

  candidates.forEach((candidate, index) => {
    shifts[index % shiftCount].push(candidate);
  });

  const absoluteShift = Math.floor(nowMs / shiftDurationMs);
  const activeShiftIndex = absoluteShift % shiftCount;
  const slides = shifts[activeShiftIndex];
  const nextShiftAt = new Date((absoluteShift + 1) * shiftDurationMs);

  return {
    slides,
    totalCandidates: candidates.length,
    shiftCount,
    activeShiftIndex,
    shiftMinutes,
    nextShiftAt,
  };
}

module.exports = {
  DEFAULT_BANNER_LIMIT,
  DEFAULT_SHIFT_MINUTES,
  selectBannerShift,
};
