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
