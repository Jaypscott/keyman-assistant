const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function calculateRotationIntervals(start, end, durationMinutes) {
  const startMinutes = parseTime(start);
  const endMinutes = parseTime(end);
  const duration = Number(durationMinutes);

  if (
    startMinutes === null
    || endMinutes === null
    || endMinutes <= startMinutes
    || !Number.isInteger(duration)
    || duration <= 0
  ) {
    return [];
  }

  const intervals = [];
  for (let current = startMinutes; current < endMinutes; current += duration) {
    intervals.push(
      `${formatMinutes(current)} - ${formatMinutes(Math.min(current + duration, endMinutes))}`,
    );
  }
  return intervals;
}

export function canUseScheduleActions(schedule, volunteerNames) {
  return Array.isArray(schedule)
    && Array.isArray(volunteerNames)
    && volunteerNames.length > 0;
}

export function createSchedule(names, shift, duration = shift.minutes) {
  if (names.length < 6) return createSmallCrewSchedule(names, shift, duration);

  const periods = calculateRotationIntervals(shift.start, shift.end, duration);
  const volunteerLimit = Number(shift.slots) >= 8 ? 8 : 6;
  let best = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const rows = [];
    const roleCounts = Object.fromEntries(names.map((name) => [name, {
      primary: 0,
      secondary: 0,
      informal: 0,
      total: 0,
    }]));
    const pairCounts = new Map();
    let cursor = shuffle(names);

    periods.forEach((period, index) => {
      if (index % Math.max(1, Math.floor(names.length / 2)) === 0) cursor = shuffle(names);
      const ranked = names
        .slice()
        .sort((a, b) => roleCounts[a].total - roleCounts[b].total || cursor.indexOf(a) - cursor.indexOf(b));
      const active = ranked.slice(0, Math.min(volunteerLimit, names.length));
      const groups = buildGroups(active, pairCounts);
      const assignments = assignRoles(groups, roleCounts);

      rows.push({ time: period, assignments });

      ["primary", "secondary", "informal"].forEach((role) => {
        assignments[role].forEach((name) => {
          roleCounts[name][role] += 1;
          roleCounts[name].total += 1;
        });
        addGroupPairs(assignments[role], pairCounts);
      });
    });

    const score = scoreSchedule(roleCounts, pairCounts);
    if (score > bestScore) {
      bestScore = score;
      best = rows;
    }
  }

  return best;
}

function parseTime(time) {
  const match = TIME_PATTERN.exec(String(time));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutes(total) {
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour24 >= 12 ? "pm" : "am";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")}${suffix}`;
}

function createSmallCrewSchedule(names, shift, duration = shift.minutes) {
  const periods = calculateRotationIntervals(shift.start, shift.end, duration);
  const primaryCounts = Object.fromEntries(names.map((name) => [name, 0]));
  const pairCounts = new Map();

  return periods.map((period, index) => {
    const ranked = names
      .slice()
      .sort((a, b) => primaryCounts[a] - primaryCounts[b] || rotateIndex(a, names, index) - rotateIndex(b, names, index));
    const primary = chooseSmallCrewPrimary(ranked, pairCounts);
    primary.forEach((name) => {
      primaryCounts[name] += 1;
    });
    addGroupPairs(primary, pairCounts);

    return {
      time: period,
      assignments: {
        primary,
        informal: names.filter((name) => !primary.includes(name)),
      },
    };
  });
}

function chooseSmallCrewPrimary(ranked, pairCounts) {
  if (ranked.length <= 2) return ranked;

  let bestPair = ranked.slice(0, 2);
  let bestScore = Infinity;
  for (let i = 0; i < ranked.length; i += 1) {
    for (let j = i + 1; j < ranked.length; j += 1) {
      const pair = [ranked[i], ranked[j]];
      const score = i + j + ((pairCounts.get(pairKey(pair[0], pair[1])) || 0) * ranked.length);
      if (score < bestScore) {
        bestScore = score;
        bestPair = pair;
      }
    }
  }

  return bestPair;
}

function rotateIndex(name, names, offset) {
  return (names.indexOf(name) + offset) % names.length;
}

function buildGroups(active, pairCounts) {
  const remaining = active.slice();
  const groups = [];

  while (remaining.length > 1) {
    let bestPair = [remaining[0], remaining[1]];
    let bestScore = Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      for (let j = i + 1; j < remaining.length; j += 1) {
        const score = pairCounts.get(pairKey(remaining[i], remaining[j])) || 0;
        if (score < bestScore) {
          bestScore = score;
          bestPair = [remaining[i], remaining[j]];
        }
      }
    }
    groups.push(bestPair);
    bestPair.forEach((person) => remaining.splice(remaining.indexOf(person), 1));
  }

  if (remaining.length) groups.push(remaining);
  return groups;
}

function assignRoles(groups, roleCounts) {
  const result = {
    primary: [],
    secondary: [],
    informal: [],
  };
  const orderedGroups = groups.slice().sort((a, b) => {
    const aTotal = a.reduce((sum, name) => sum + roleCounts[name].total, 0);
    const bTotal = b.reduce((sum, name) => sum + roleCounts[name].total, 0);
    return aTotal - bTotal;
  });

  ["primary", "secondary"].forEach((role) => {
    let bestIndex = -1;
    let bestScore = Infinity;
    orderedGroups.forEach((group, index) => {
      if (group.length !== 2) return;
      const score = group.reduce((sum, name) => sum + roleCounts[name][role], 0);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0) result[role] = orderedGroups.splice(bestIndex, 1)[0];
  });

  result.informal = orderedGroups.flat();
  return result;
}

function scoreSchedule(roleCounts, pairCounts) {
  const totals = Object.values(roleCounts).map((count) => count.total);
  const roleSpread = Object.values(roleCounts).reduce((sum, count) => {
    const values = [count.primary, count.secondary, count.informal];
    return sum + (Math.max(...values) - Math.min(...values));
  }, 0);
  const pairSpread = pairCounts.size ? Math.max(...pairCounts.values()) - Math.min(...pairCounts.values()) : 0;
  return 1000 - ((Math.max(...totals) - Math.min(...totals)) * 18) - (roleSpread * 7) - (pairSpread * 5);
}

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function addGroupPairs(group, pairCounts) {
  for (let i = 0; i < group.length; i += 1) {
    for (let j = i + 1; j < group.length; j += 1) {
      const key = pairKey(group[i], group[j]);
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
  }
}

function pairKey(a, b) {
  return [a, b].sort().join("::");
}
