import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

export type FailedItemType = 'mod' | 'file';

interface FailedItemBase {
	id: string;
	type: FailedItemType;
	reason: string;
	attempts: number;
	createdAt: string;
	updatedAt: string;
}

export interface FailedModItem extends FailedItemBase {
	type: 'mod';
	slug: string;
	page?: number;
}

export interface FailedFileItem extends FailedItemBase {
	type: 'file';
	slug: string;
	url: string;
}

export type FailedItem = FailedModItem | FailedFileItem;

interface FailedQueueState {
	updatedAt: string;
	items: FailedItem[];
}

export class FailedQueueService {
	private readonly queueFile: string;

	constructor(filename: string = 'failed-items.json') {
		this.queueFile = path.join(process.cwd(), filename);
	}

	addModFailure(slug: string, reason: string, page?: number): void {
		if (!slug) return;
		const state = this.readState();
		const existing = state.items.find((item) => item.type === 'mod' && item.slug === slug);

		if (existing && existing.type === 'mod') {
			existing.reason = reason;
			existing.page = page ?? existing.page;
			existing.updatedAt = new Date().toISOString();
			this.writeState(state);
			return;
		}

		state.items.push({
			id: randomUUID(),
			type: 'mod',
			slug,
			page,
			reason,
			attempts: 0,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		});
		this.writeState(state);
	}

	addFileFailure(slug: string, url: string, reason: string): void {
		if (!slug || !url) return;
		const state = this.readState();
		const existing = state.items.find((item) => item.type === 'file' && item.slug === slug && item.url === url);

		if (existing && existing.type === 'file') {
			existing.reason = reason;
			existing.updatedAt = new Date().toISOString();
			this.writeState(state);
			return;
		}

		state.items.push({
			id: randomUUID(),
			type: 'file',
			slug,
			url,
			reason,
			attempts: 0,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		});
		this.writeState(state);
	}

	list(): FailedItem[] {
		return this.readState().items;
	}

	remove(id: string): void {
		const state = this.readState();
		state.items = state.items.filter((item) => item.id !== id);
		this.writeState(state);
	}

	markAttempt(id: string, reason: string): void {
		const state = this.readState();
		const item = state.items.find((candidate) => candidate.id === id);
		if (!item) return;
		item.attempts += 1;
		item.reason = reason;
		item.updatedAt = new Date().toISOString();
		this.writeState(state);
	}

	private readState(): FailedQueueState {
		if (!fs.existsSync(this.queueFile)) {
			return { updatedAt: new Date().toISOString(), items: [] };
		}

		try {
			const raw = fs.readFileSync(this.queueFile, 'utf8');
			const parsed = JSON.parse(raw) as FailedQueueState;
			if (!Array.isArray(parsed.items)) {
				return { updatedAt: new Date().toISOString(), items: [] };
			}
			return parsed;
		} catch (err) {
			logger.error({ err, file: this.queueFile }, 'Не удалось прочитать failed queue, будет создана новая');
			return { updatedAt: new Date().toISOString(), items: [] };
		}
	}

	private writeState(state: FailedQueueState): void {
		try {
			state.updatedAt = new Date().toISOString();
			fs.writeFileSync(this.queueFile, JSON.stringify(state, null, 2), 'utf8');
		} catch (err) {
			logger.error({ err, file: this.queueFile }, 'Не удалось записать failed queue');
		}
	}
}
