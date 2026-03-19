/**
 * ValueStream Recorder — Recording Comparison Module
 * Compares two recordings side-by-side for improvement analysis.
 */

/**
 * Compare two recordings and return a detailed analysis.
 * @param {{ steps: Array, startTime: string, endTime: string }} recordingA - The "before" recording
 * @param {{ steps: Array, startTime: string, endTime: string }} recordingB - The "after" recording
 * @returns {object} Comparison result
 */
function compareRecordings(recordingA, recordingB) {
  const durationA = calcTotalDuration(recordingA);
  const durationB = calcTotalDuration(recordingB);
  const durationDiff = durationB - durationA;
  const durationDiffPct = durationA > 0 ? ((durationDiff / durationA) * 100) : 0;

  const stepCountA = recordingA.steps.length;
  const stepCountB = recordingB.steps.length;
  const stepCountDiff = stepCountB - stepCountA;

  const vaTimeA = calcVATime(recordingA.steps);
  const vaTimeB = calcVATime(recordingB.steps);
  const nvaTimeA = calcNVATime(recordingA.steps);
  const nvaTimeB = calcNVATime(recordingB.steps);

  const vaPctA = durationA > 0 ? (vaTimeA / durationA) * 100 : 0;
  const vaPctB = durationB > 0 ? (vaTimeB / durationB) * 100 : 0;
  const vaPctDiff = vaPctB - vaPctA;

  // Per-step matching by stage_name similarity
  const stepMatching = matchSteps(recordingA.steps, recordingB.steps);

  // Steps added, removed, or changed
  const added = stepMatching.filter(m => m.type === 'added');
  const removed = stepMatching.filter(m => m.type === 'removed');
  const changed = stepMatching.filter(m => m.type === 'changed');
  const unchanged = stepMatching.filter(m => m.type === 'matched');

  // Overall improvement: positive = better (shorter duration, higher VA%)
  // Weighted: 60% lead time improvement, 40% VA% improvement
  const leadTimeImprovement = durationA > 0 ? ((-durationDiff / durationA) * 100) : 0;
  const vaImprovement = vaPctDiff; // positive = more VA work
  const overallImprovement = (leadTimeImprovement * 0.6) + (vaImprovement * 0.4);

  return {
    before: {
      duration: durationA,
      stepCount: stepCountA,
      vaTime: vaTimeA,
      nvaTime: nvaTimeA,
      vaPct: vaPctA
    },
    after: {
      duration: durationB,
      stepCount: stepCountB,
      vaTime: vaTimeB,
      nvaTime: nvaTimeB,
      vaPct: vaPctB
    },
    deltas: {
      duration: durationDiff,
      durationPct: durationDiffPct,
      stepCount: stepCountDiff,
      vaPct: vaPctDiff,
      vaTime: vaTimeB - vaTimeA,
      nvaTime: nvaTimeB - nvaTimeA
    },
    stepMatching,
    added,
    removed,
    changed,
    unchanged,
    overallImprovement
  };
}

/**
 * Calculate total duration in seconds from a recording.
 */
function calcTotalDuration(recording) {
  if (recording.startTime && recording.endTime) {
    return (new Date(recording.endTime) - new Date(recording.startTime)) / 1000;
  }
  return recording.steps.reduce((sum, s) => sum + (s.duration_secs || 0), 0);
}

/**
 * Calculate total VA time from steps.
 */
function calcVATime(steps) {
  return steps
    .filter(s => s.va_type === 'va')
    .reduce((sum, s) => sum + (s.duration_secs || 0), 0);
}

/**
 * Calculate total NVA time from steps.
 */
function calcNVATime(steps) {
  return steps
    .filter(s => s.va_type === 'nva')
    .reduce((sum, s) => sum + (s.duration_secs || 0), 0);
}

/**
 * Match steps between two recordings by stage_name similarity.
 * Uses a simple Levenshtein-based approach to find best matches.
 * @returns {Array<{ type: 'matched'|'changed'|'added'|'removed', before?: object, after?: object, similarity?: number }>}
 */
function matchSteps(stepsA, stepsB) {
  const results = [];
  const usedB = new Set();

  // For each step in A, find the best match in B
  for (const stepA of stepsA) {
    let bestMatch = null;
    let bestSimilarity = 0;
    let bestIndex = -1;

    for (let j = 0; j < stepsB.length; j++) {
      if (usedB.has(j)) continue;
      const sim = stringSimilarity(stepA.stage_name || '', stepsB[j].stage_name || '');
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestMatch = stepsB[j];
        bestIndex = j;
      }
    }

    if (bestMatch && bestSimilarity >= 0.5) {
      usedB.add(bestIndex);
      const durationChanged = Math.abs((stepA.duration_secs || 0) - (bestMatch.duration_secs || 0)) > 0.5;
      const vaChanged = stepA.va_type !== bestMatch.va_type;
      const type = (durationChanged || vaChanged) ? 'changed' : 'matched';
      results.push({
        type,
        before: stepA,
        after: bestMatch,
        similarity: bestSimilarity,
        durationDelta: (bestMatch.duration_secs || 0) - (stepA.duration_secs || 0)
      });
    } else {
      results.push({ type: 'removed', before: stepA, after: null });
    }
  }

  // Remaining unmatched steps in B are "added"
  for (let j = 0; j < stepsB.length; j++) {
    if (!usedB.has(j)) {
      results.push({ type: 'added', before: null, after: stepsB[j] });
    }
  }

  return results;
}

/**
 * Simple string similarity (0-1) using bigram overlap (Dice coefficient).
 */
function stringSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;

  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();

  if (a === b) return 1;

  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }

  const bigramsA = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) || 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigramsA.get(bigram) || 0;
    if (count > 0) {
      bigramsA.set(bigram, count - 1);
      intersectionSize++;
    }
  }

  return (2.0 * intersectionSize) / ((a.length - 1) + (b.length - 1));
}
