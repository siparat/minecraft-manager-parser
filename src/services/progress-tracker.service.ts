import { logger } from '../utils/logger';

export interface ProgressStats {
	page: number;
	modsSeen: number;
	modsCreated: number;
	modsUpdated: number;
	modsFailed: number;
	filesUploaded: number;
	filesFailed: number;
	filesSkipped: number;
	startedAt: number;
}

export class ProgressTrackerService {
	private stats: ProgressStats = this.initialStats();
	private timer: NodeJS.Timeout | null = null;
	private readonly intervalMs: number;
	private label: string = 'PROGRESS';
	private liveLineActive: boolean = false;

	constructor(intervalMs: number = 3000) {
		this.intervalMs = intervalMs;
	}

	start(label: string = 'PROGRESS'): void {
		this.label = label;
		this.stats = this.initialStats();
		this.stats.startedAt = Date.now();
		this.liveLineActive = false;

		if (this.timer) clearInterval(this.timer);
		this.render();
		this.timer = setInterval(() => this.render(), this.intervalMs);
		this.timer.unref?.();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.clearLiveLine();
		this.renderFinal();
	}

	setPage(page: number): void {
		this.stats.page = page;
	}

	incModsSeen(n: number = 1): void {
		this.stats.modsSeen += n;
	}

	incCreated(): void {
		this.stats.modsCreated++;
	}

	incUpdated(): void {
		this.stats.modsUpdated++;
	}

	incFailed(): void {
		this.stats.modsFailed++;
	}

	incFilesUploaded(): void {
		this.stats.filesUploaded++;
	}

	incFilesFailed(): void {
		this.stats.filesFailed++;
	}

	incFilesSkipped(): void {
		this.stats.filesSkipped++;
	}

	getStats(): ProgressStats {
		return { ...this.stats };
	}

	private initialStats(): ProgressStats {
		return {
			page: 0,
			modsSeen: 0,
			modsCreated: 0,
			modsUpdated: 0,
			modsFailed: 0,
			filesUploaded: 0,
			filesFailed: 0,
			filesSkipped: 0,
			startedAt: 0
		};
	}

	private elapsedSec(): number {
		if (!this.stats.startedAt) return 0;
		return Math.max(1, Math.floor((Date.now() - this.stats.startedAt) / 1000));
	}

	private formatElapsed(sec: number): string {
		const h = Math.floor(sec / 3600)
			.toString()
			.padStart(2, '0');
		const m = Math.floor((sec % 3600) / 60)
			.toString()
			.padStart(2, '0');
		const s = (sec % 60).toString().padStart(2, '0');
		return `${h}:${m}:${s}`;
	}

	private render(): void {
		const el = this.elapsedSec();
		const { page, modsSeen, modsCreated, modsUpdated, modsFailed, filesUploaded, filesFailed, filesSkipped } =
			this.stats;
		const processed = modsCreated + modsUpdated + modsFailed;
		const rate = processed > 0 ? (processed / el).toFixed(2) : '0.00';
		const line = `[${this.label}] страница=${page} | встречено=${modsSeen} | моды +${modsCreated}/~${modsUpdated}/x${modsFailed} | файлы +${filesUploaded}/->${filesSkipped}/x${filesFailed} | ${rate} модов/сек | прошло=${this.formatElapsed(el)}`;

		if (this.canRenderLiveLine()) {
			this.writeLiveLine(line);
			return;
		}

		logger.info(line);
	}

	private renderFinal(): void {
		const el = this.elapsedSec();
		const s = this.stats;
		const processed = s.modsCreated + s.modsUpdated + s.modsFailed;
		const rate = processed > 0 ? (processed / el).toFixed(2) : '0.00';

		logger.info(
			{
				page: s.page,
				modsSeen: s.modsSeen,
				modsCreated: s.modsCreated,
				modsUpdated: s.modsUpdated,
				modsFailed: s.modsFailed,
				filesUploaded: s.filesUploaded,
				filesFailed: s.filesFailed,
				filesSkipped: s.filesSkipped,
				rate: `${rate} mods/s`,
				elapsed: this.formatElapsed(el)
			},
			`Итоговый отчет`
		);
	}

	private canRenderLiveLine(): boolean {
		return Boolean(process.stdout.isTTY && process.stderr.isTTY);
	}

	private writeLiveLine(line: string): void {
		process.stdout.clearLine(0);
		process.stdout.cursorTo(0);
		process.stdout.write(line);
		this.liveLineActive = true;
	}

	private clearLiveLine(): void {
		if (!this.liveLineActive || !this.canRenderLiveLine()) {
			return;
		}

		process.stdout.clearLine(0);
		process.stdout.cursorTo(0);
		process.stdout.write('\n');
		this.liveLineActive = false;
	}
}
