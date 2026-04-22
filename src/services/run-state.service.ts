import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export type RunMode = 'scrape' | 'update-s3' | 'retry-failed' | 'update-single-mod-files';
export type RunStatus = 'running' | 'completed' | 'crashed';

export interface RunCheckpoint {
	page?: number;
	modId?: number;
	failedItemId?: string;
}

export interface RunState {
	mode: RunMode;
	status: RunStatus;
	startedAt: string;
	updatedAt: string;
	checkpoint: RunCheckpoint;
	error?: string;
}

export class RunStateService {
	private readonly stateFile: string;

	constructor(filename: string = 'run-state.json') {
		this.stateFile = path.join(process.cwd(), filename);
	}

	getState(): RunState | null {
		if (!fs.existsSync(this.stateFile)) return null;
		try {
			const raw = fs.readFileSync(this.stateFile, 'utf8');
			return JSON.parse(raw) as RunState;
		} catch (err) {
			logger.error({ err, file: this.stateFile }, 'Не удалось прочитать состояние запуска');
			return null;
		}
	}

	start(mode: RunMode, checkpoint: RunCheckpoint = {}): void {
		this.write({
			mode,
			status: 'running',
			startedAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			checkpoint
		});
	}

	checkpoint(patch: RunCheckpoint): void {
		const current = this.getState();
		if (!current) return;
		this.write({
			...current,
			status: 'running',
			updatedAt: new Date().toISOString(),
			checkpoint: {
				...current.checkpoint,
				...patch
			}
		});
	}

	complete(): void {
		const current = this.getState();
		if (!current) return;
		this.write({
			...current,
			status: 'completed',
			updatedAt: new Date().toISOString(),
			error: undefined
		});
	}

	crash(error: string): void {
		const current = this.getState();
		if (!current) return;
		this.write({
			...current,
			status: 'crashed',
			updatedAt: new Date().toISOString(),
			error
		});
	}

	clear(): void {
		try {
			if (fs.existsSync(this.stateFile)) fs.unlinkSync(this.stateFile);
		} catch (err) {
			logger.error({ err, file: this.stateFile }, 'Не удалось удалить состояние запуска');
		}
	}

	private write(state: RunState): void {
		try {
			fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf8');
		} catch (err) {
			logger.error({ err, file: this.stateFile }, 'Не удалось записать состояние запуска');
		}
	}
}
