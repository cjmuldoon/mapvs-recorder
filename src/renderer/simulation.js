/**
 * ValueStream Recorder - Local Process Simulation (Monte Carlo)
 * Lightweight client-side simulation - no server needed.
 * Runs entirely in the renderer process.
 */

// Box-Muller transform for standard normal random numbers
function boxMuller() {
  let u1 = Math.random();
  const u2 = Math.random();
  while (u1 === 0) u1 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

// Apply normal distribution variation to a value
function varied(value, variationPct = 15) {
  if (value <= 0) return 0;
  const factor = 1.0 + (boxMuller() * variationPct / 100.0);
  return Math.max(0, value * factor);
}

// Calculate percentile from sorted array
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const k = (sorted.length - 1) * p / 100;
  const f = Math.floor(k);
  const c = Math.ceil(k);
  if (f === c) return sorted[Math.round(k)];
  return sorted[f] * (c - k) + sorted[c] * (k - f);
}

/**
 * Run Monte Carlo simulation on recording steps.
 *
 * @param {Array} steps - Array of step objects from recording.
 *   Each step should have: { stage_name, duration_secs, cycle_time, wait_time, va_type }
 * @param {Object} params - Simulation parameters.
 *   { numSimulations: 100, variationPct: 15, demandRate: 10, availableTimeHrs: 8 }
 * @returns {Object} Simulation results.
 */
function simulateProcess(steps, params = {}) {
  if (!steps || steps.length === 0) {
    return { runs: 0, leadTime: {}, cycleTime: {}, pce: {}, wip: {}, throughput: {}, bottleneckFrequency: {}, stageMetrics: [] };
  }

  const numSims = Math.min(Math.max(params.numSimulations || 100, 1), 2000);
  const variationPct = params.variationPct || 15;
  const availableTimeHrs = params.availableTimeHrs || 8;

  // Normalise steps into stages
  const stages = steps.map((step, i) => {
    const cycleSecs = step.cycle_time || step.duration_secs || 0;
    const waitSecs = step.wait_time || 0;
    // Convert seconds to hours for consistency
    const cycleHrs = cycleSecs / 3600;
    const waitHrs = waitSecs / 3600;
    const isVA = step.va_type === 'va';

    return {
      name: step.stage_name || step.window_title || `Step ${i + 1}`,
      cycleTimeHrs: cycleHrs,
      waitTimeHrs: waitHrs,
      valueAdd: isVA,
      defectRatePct: 0, // Not captured in recordings
    };
  });

  const leadTimes = [];
  const cycleTimes = [];
  const pceValues = [];
  const wipValues = [];
  const throughputValues = [];
  const bottleneckCounts = {};
  stages.forEach(s => { bottleneckCounts[s.name] = 0; });

  // Per-stage accumulators
  const stageCycleAccum = {};
  stages.forEach(s => { stageCycleAccum[s.name] = []; });

  for (let sim = 0; sim < numSims; sim++) {
    let totalCycle = 0;
    let totalWait = 0;
    let vaCycle = 0;
    let maxEffectiveCycle = 0;
    let bottleneckStage = stages[0].name;

    for (const s of stages) {
      const ct = varied(s.cycleTimeHrs, variationPct);
      const wt = varied(s.waitTimeHrs, variationPct);

      totalCycle += ct;
      totalWait += wt;
      if (s.valueAdd) vaCycle += ct;

      stageCycleAccum[s.name].push(ct);

      if (ct > maxEffectiveCycle) {
        maxEffectiveCycle = ct;
        bottleneckStage = s.name;
      }
    }

    const leadTime = totalCycle + totalWait;
    const pce = leadTime > 0 ? (vaCycle / leadTime * 100) : 0;
    const throughputRate = maxEffectiveCycle > 0 ? (1.0 / maxEffectiveCycle) : 0;
    const wip = throughputRate * leadTime;
    const dailyThroughput = throughputRate * availableTimeHrs;

    leadTimes.push(parseFloat(leadTime.toFixed(4)));
    cycleTimes.push(parseFloat(totalCycle.toFixed(4)));
    pceValues.push(parseFloat(pce.toFixed(2)));
    wipValues.push(parseFloat(wip.toFixed(2)));
    throughputValues.push(parseFloat(dailyThroughput.toFixed(2)));
    bottleneckCounts[bottleneckStage] = (bottleneckCounts[bottleneckStage] || 0) + 1;
  }

  // Sort for percentiles
  leadTimes.sort((a, b) => a - b);
  cycleTimes.sort((a, b) => a - b);
  pceValues.sort((a, b) => a - b);
  wipValues.sort((a, b) => a - b);
  throughputValues.sort((a, b) => a - b);

  function stats(vals) {
    if (!vals.length) return { mean: 0, p10: 0, p50: 0, p90: 0 };
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return {
      mean: parseFloat(mean.toFixed(2)),
      p10: parseFloat(percentile(vals, 10).toFixed(2)),
      p50: parseFloat(percentile(vals, 50).toFixed(2)),
      p90: parseFloat(percentile(vals, 90).toFixed(2)),
    };
  }

  // Convert lead time stats back to seconds for display in recorder context
  const ltStats = stats(leadTimes);
  const ctStats = stats(cycleTimes);

  const leadTimeSeconds = {
    mean: parseFloat((ltStats.mean * 3600).toFixed(1)),
    p10: parseFloat((ltStats.p10 * 3600).toFixed(1)),
    p50: parseFloat((ltStats.p50 * 3600).toFixed(1)),
    p90: parseFloat((ltStats.p90 * 3600).toFixed(1)),
  };
  const cycleTimeSeconds = {
    mean: parseFloat((ctStats.mean * 3600).toFixed(1)),
    p10: parseFloat((ctStats.p10 * 3600).toFixed(1)),
    p50: parseFloat((ctStats.p50 * 3600).toFixed(1)),
    p90: parseFloat((ctStats.p90 * 3600).toFixed(1)),
  };

  // Per-stage metrics
  const stageMetrics = stages.map(s => {
    const cycles = stageCycleAccum[s.name] || [];
    const avgCycleHrs = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;
    const bnPct = numSims > 0 ? ((bottleneckCounts[s.name] || 0) / numSims * 100) : 0;
    return {
      stage: s.name,
      avgCycleSecs: parseFloat((avgCycleHrs * 3600).toFixed(1)),
      bottleneckPct: parseFloat(bnPct.toFixed(1)),
    };
  });

  // Sort bottleneck frequency descending
  const sortedBn = Object.entries(bottleneckCounts)
    .sort((a, b) => b[1] - a[1])
    .reduce((obj, [k, v]) => { obj[k] = v; return obj; }, {});

  return {
    runs: numSims,
    leadTime: leadTimeSeconds,
    cycleTime: cycleTimeSeconds,
    pce: stats(pceValues),
    wip: stats(wipValues),
    throughput: stats(throughputValues),
    bottleneckFrequency: sortedBn,
    stageMetrics,
  };
}

// Expose globally for use by renderer.js
window.simulateProcess = simulateProcess;
