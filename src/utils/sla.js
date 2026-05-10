const CAL = {
  startHour: 8,
  endHour: 17,
  workDays: [1, 2, 3, 4, 5]
};

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function isWorkingDay(d) {
  return CAL.workDays.includes(d.getDay());
}

function atTime(d, hour, minute = 0, second = 0, ms = 0) {
  const x = new Date(d);
  x.setHours(hour, minute, second, ms);
  return x;
}

function businessStart(d) { return atTime(d, CAL.startHour, 0, 0, 0); }
function businessEnd(d) { return atTime(d, CAL.endHour, 0, 0, 0); }

function nextWorkingDayStart(d) {
  let x = new Date(d);
  x = atTime(x, 0, 0, 0, 0);
  do { x = addMinutes(x, 24 * 60); } while (!isWorkingDay(x));
  return businessStart(x);
}

function clampToBusinessTime(d) {
  let x = new Date(d);
  if (!isWorkingDay(x)) return nextWorkingDayStart(x);

  const start = businessStart(x);
  const end = businessEnd(x);

  if (x < start) return start;
  if (x >= end) return nextWorkingDayStart(x);
  return x;
}

function addBusinessMinutes(from, minutes) {
  let remaining = Math.max(0, Math.floor(minutes));
  let cur = clampToBusinessTime(from);

  while (remaining > 0) {
    const end = businessEnd(cur);
    const available = Math.floor((end.getTime() - cur.getTime()) / 60000);

    if (remaining <= available) return addMinutes(cur, remaining);

    remaining -= available;
    cur = nextWorkingDayStart(cur);
  }
  return cur;
}

function businessMinutesBetween(a, b) {
  const start = new Date(a);
  const end = new Date(b);
  if (end <= start) return 0;

  let cur = clampToBusinessTime(start);
  let total = 0;

  while (cur < end) {
    const dayEnd = businessEnd(cur);
    const segmentEnd = dayEnd < end ? dayEnd : end;

    if (segmentEnd > cur) total += (segmentEnd.getTime() - cur.getTime()) / 60000;
    if (segmentEnd >= end) break;

    cur = nextWorkingDayStart(cur);
  }
  return Math.ceil(total);
}

const SLA = {
  responseMin: { URGENT: 15, HIGH: 30, MEDIUM: 60, LOW: 120 },
  resolutionMin: { URGENT: 120, HIGH: 240, MEDIUM: 480, LOW: 1440 }
};

function computeSlaDates(createdAt, priority) {
  const p = priority || 'MEDIUM';
  return {
    responseDueAt: addBusinessMinutes(createdAt, SLA.responseMin[p]),
    resolutionDueAt: addBusinessMinutes(createdAt, SLA.resolutionMin[p])
  };
}

function isResolutionPausedStatus(status) {
  return status === 'WAITING';
}

module.exports = {
  addMinutes,
  addBusinessMinutes,
  businessMinutesBetween,
  computeSlaDates,
  isResolutionPausedStatus
};
