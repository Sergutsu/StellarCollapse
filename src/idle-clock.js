// Pure, framework-free helpers for idle dispatch job timing and progress.
// Designed so MetaState and HubScene can drive persistent wall-time idles
// without embedding Date.now() or timer logic in the state layer.
// 100% node --test friendly; callers always inject "now".

/**
 * Compute derived timing/progress for a persisted idle job.
 * @param {object} job - Job descriptor (must contain endsAt, etaSec, startedAt, rewardCredits)
 * @param {number} [nowMs] - Wall time (default Date.now())
 * @returns {{ remainingSec: number, done: boolean, progressPct: number }}
 */
export function computeJobState(job, nowMs = Date.now()) {
    if (!job || typeof job.endsAt !== 'number') {
        return { remainingSec: 0, done: true, progressPct: 1 };
    }
    const remainingMs = Math.max(0, job.endsAt - nowMs);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const done = remainingSec <= 0;

    const durationMs = Math.max(1, (job.etaSec || 1) * 1000);
    const elapsedMs = Math.max(0, nowMs - (job.startedAt || (nowMs - durationMs)));
    const progressPct = Math.min(1, Math.max(0, elapsedMs / durationMs));

    return { remainingSec, done, progressPct };
}

/**
 * Compute the partial credit payout for an abort at the given time.
 * Mirrors the original _abortIdleMission math but pure.
 */
export function computePartialCredits(job, nowMs = Date.now()) {
    const { progressPct } = computeJobState(job, nowMs);
    return Math.max(0, Math.floor((job.rewardCredits || 0) * progressPct));
}

/** Convenience predicate */
export function isJobDone(job, nowMs = Date.now()) {
    return computeJobState(job, nowMs).done;
}

/**
 * Partition a list of jobs into still-active vs ready-to-claim (done) at nowMs.
 * Pure transform — does not mutate.
 */
export function partitionJobs(jobs = [], nowMs = Date.now()) {
    const active = [];
    const ready = [];
    for (const job of jobs) {
        if (isJobDone(job, nowMs)) {
            ready.push(job);
        } else {
            active.push(job);
        }
    }
    return { active, ready };
}

/**
 * Build a minimal "recovered" placeholder job (used defensively when
 * MetaState has On-Mission flags but no corresponding persisted dispatch).
 * Mirrors the previous reconcile recovery shape.
 */
export function makeRecoveryJob(ship, crew, seq = 1) {
    const now = Date.now();
    return {
        id: `dispatch-recovered-${seq}`,
        offerId: 'recovered-assignment',
        title: 'Recovered Idle Assignment',
        type: 'recovery',
        dispatchMode: 'idle',
        risk: 1,
        rewardCredits: 0,
        rewardOres: { common: [], rare: [] },
        shipId: ship.id,
        shipName: ship.name,
        crewId: crew.id,
        crewName: crew.name,
        startedAt: now,
        etaSec: 0,
        endsAt: now,
        claimed: false,
    };
}

/**
 * Offline / "welcome back" summary.
 *
 * Idle jobs store absolute `endsAt` timestamps, so a contract that
 * finished while the tab was closed is already complete when the player
 * returns — nothing has to be simulated. What was missing was the
 * *report*: an idle game has to tell the player what happened while they
 * were away, otherwise the payout reads as a random number.
 *
 * @param {object} opts
 * @param {Array}  opts.jobs          persisted active missions
 * @param {number} [opts.lastSeenMs]  MetaState.lastTickAt (when the hub last ran)
 * @param {number} [opts.nowMs]
 * @returns {{away:boolean, awaySec:number, awayLabel:string, completed:Array,
 *            pending:Array, credits:number, oreUnits:number}}
 */
export function summarizeOffline({ jobs = [], lastSeenMs = 0, nowMs = Date.now() } = {}) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const last = Number.isFinite(lastSeenMs) && lastSeenMs > 0 ? lastSeenMs : now;
    const awayMs = Math.max(0, now - last);
    const list = Array.isArray(jobs) ? jobs : [];
    const { active, ready } = partitionJobs(list, now);

    // Only count jobs that actually finished *during* the absence.
    const completed = ready.filter((j) => Number.isFinite(j.endsAt) && j.endsAt >= last);
    const credits = completed.reduce((sum, j) => sum + Math.max(0, Math.floor(j.rewardCredits || 0)), 0);
    const oreUnits = completed.reduce((sum, j) => {
        const common = Array.isArray(j.rewardOres?.common) ? j.rewardOres.common.length : 0;
        const rare = Array.isArray(j.rewardOres?.rare) ? j.rewardOres.rare.length : 0;
        return sum + common + rare;
    }, 0);

    return {
        away: awayMs >= 60_000,
        awaySec: Math.floor(awayMs / 1000),
        awayLabel: formatAway(awayMs),
        completed,
        pending: active,
        ready: ready.length,
        credits,
        oreUnits,
    };
}

/** Coarse "3h 12m" style label for the welcome-back banner. */
export function formatAway(ms) {
    const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}
