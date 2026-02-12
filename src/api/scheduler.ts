/**
 * Cron-based day scheduler.
 * Auto-starts and auto-finalizes days on configurable schedules.
 */

import * as cron from 'node-cron';
import { ApiState } from './state';
import { startNewDay, finalizeCurrent } from '../services/dayLifecycleService';

export interface SchedulerConfig {
  startCron: string;       // e.g. '0 0 * * *' (midnight UTC)
  finalizeCron: string;    // e.g. '55 23 * * *' (23:55 UTC)
  timezone: string;        // e.g. 'UTC'
}

export class DayScheduler {
  private startJob: cron.ScheduledTask | null = null;
  private finalizeJob: cron.ScheduledTask | null = null;

  constructor(
    private state: ApiState,
    private config: SchedulerConfig
  ) {}

  start(): void {
    this.startJob = cron.schedule(this.config.startCron, () => {
      this.handleStartDay();
    }, { timezone: this.config.timezone });

    this.finalizeJob = cron.schedule(this.config.finalizeCron, () => {
      this.handleFinalizeDay();
    }, { timezone: this.config.timezone });

    console.log(
      `Scheduler: start="${this.config.startCron}", finalize="${this.config.finalizeCron}" (${this.config.timezone})`
    );
  }

  stop(): void {
    this.startJob?.stop();
    this.finalizeJob?.stop();
    this.startJob = null;
    this.finalizeJob = null;
  }

  private handleStartDay(): void {
    if (this.state.dayPhase !== 'IDLE') {
      console.log(`Scheduler: skip start, phase=${this.state.dayPhase}`);
      return;
    }

    if (this.state.networkState.contributors.size === 0) {
      console.log('Scheduler: skip start, no registered nodes');
      return;
    }

    try {
      const result = startNewDay(this.state);
      console.log(
        `Scheduler: started day ${result.dayId}, ${result.activeContributors} contributors, ${result.totalBlocks} blocks`
      );
    } catch (err) {
      console.error('Scheduler: start day failed:', err);
    }
  }

  private handleFinalizeDay(): void {
    if (this.state.dayPhase !== 'ACTIVE') {
      console.log(`Scheduler: skip finalize, phase=${this.state.dayPhase}`);
      return;
    }

    finalizeCurrent(this.state)
      .then(result => {
        console.log(`Scheduler: finalized day ${result.dayId}`);
      })
      .catch(err => {
        this.state.dayPhase = 'ACTIVE';
        console.error('Scheduler: finalize failed:', err);
      });
  }
}
