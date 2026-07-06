import { Download, ParsedMod, ParsedModShort } from '../interfaces/mod.interface';
import { ParserGateway } from '../gateways/parser.gateway';
import { ModRepository } from '../repositories/mod.repository';
import { ModEntity } from '../entities/mod.entity';
import { ContentParserService } from './content-parser.service';
import { FileStorageService } from './file-storage.service';
import { FailedFileItem, FailedModItem, FailedQueueService } from './failed-queue.service';
import { ProgressTrackerService } from './progress-tracker.service';
import { logger } from '../utils/logger';
import { Mod } from '../../generated/prisma';

const DEFAULT_MOD_FILES_TIMEOUT_MS = 30 * 60 * 1000;

const parsePositiveInteger = (value: string | null, fallback: number): number => {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export class ParserService {
	private readonly modFilesTimeoutMs = parsePositiveInteger(
		process.env.MOD_FILES_TIMEOUT_MS || null,
		DEFAULT_MOD_FILES_TIMEOUT_MS
	);

	constructor(
		private parserGateway: ParserGateway,
		private modRepository: ModRepository,
		private contentParser: ContentParserService,
		private fileStorage: FileStorageService,
		private progressTracker?: ProgressTrackerService,
		private failedQueue?: FailedQueueService
	) {}

	async getRelevantLinks(slug: string): Promise<ParsedMod['downloads'] | null> {
		const page = await this.parserGateway.getModPage(slug);
		if (!page) return null;

		const downloads: Download[] = page.nuxtState?.state?.slug?.model?.downloads;
		if (!downloads || !downloads.length) return null;

		const filteredDownloads = Array.from(new Map(downloads.map((d) => [d.file, d])).values());
		if (filteredDownloads.some(({ file }) => file.startsWith('/leaving'))) return null;

		return filteredDownloads;
	}

	async updateModfilesInS3(): Promise<void> {
		const mods = await this.modRepository.findUsedMods();
		this.progressTracker?.incModsSeen(mods.length);

		for (const mod of mods) {
			try {
				logger.info({ modId: mod.id, slug: mod.parsedSlug }, 'Updating mod files');
				const files = await this.saveModfilesToS3WithTimeout(mod);

				if (files) {
					await this.modRepository.updateFiles(mod.id, Array.from(new Set(files)));
					this.progressTracker?.incUpdated();
				} else {
					this.progressTracker?.incFailed();
				}
			} catch (err) {
				logger.error({ err, modId: mod.id, slug: mod.parsedSlug }, 'Ошибка при обновлении файлов мода');
				this.progressTracker?.incFailed();
				if (mod.parsedSlug) {
					this.failedQueue?.addModFailure(mod.parsedSlug, 'update_s3_failed');
				}
			}
		}
	}

	async updateModfilesInS3WithResume(options?: {
		resumeFromModId?: number;
		onCheckpoint?: (modId: number) => void;
	}): Promise<void> {
		const mods = (await this.modRepository.findUsedMods()).sort((a, b) => a.id - b.id);
		const resumeFromModId = options?.resumeFromModId;
		const queue = typeof resumeFromModId === 'number' ? mods.filter((mod) => mod.id > resumeFromModId) : mods;

		this.progressTracker?.incModsSeen(queue.length);

		for (const mod of queue) {
			try {
				logger.info({ modId: mod.id, slug: mod.parsedSlug }, 'Updating mod files');
				const files = await this.saveModfilesToS3WithTimeout(mod);

				if (files) {
					await this.modRepository.updateFiles(mod.id, Array.from(new Set(files)));
					this.progressTracker?.incUpdated();
				} else {
					this.progressTracker?.incFailed();
				}
			} catch (err) {
				logger.error({ err, modId: mod.id, slug: mod.parsedSlug }, 'Ошибка при обновлении файлов мода');
				this.progressTracker?.incFailed();
				if (mod.parsedSlug) {
					this.failedQueue?.addModFailure(mod.parsedSlug, 'update_s3_failed');
				}
			} finally {
				options?.onCheckpoint?.(mod.id);
			}
		}
	}

	async updateSingleModFiles({ id }: { id: number }): Promise<void> {
		const mod = await this.modRepository.findById(id);
		if (!mod) {
			throw new Error('Мод не найден в базе данных');
		}

		this.progressTracker?.incModsSeen(1);

		try {
			logger.info({ modId: mod.id, slug: mod.parsedSlug }, 'Updating single mod files');
			const files = await this.saveModfilesToS3WithTimeout(mod);
			if (!files) {
				if (mod.parsedSlug) {
					this.failedQueue?.addModFailure(mod.parsedSlug, 'single_mod_update_failed');
				}
				throw new Error('Не удалось обновить файлы мода');
			}

			await this.modRepository.updateFiles(mod.id, Array.from(new Set(files)));
			this.progressTracker?.incUpdated();
		} catch (err) {
			this.progressTracker?.incFailed();
			if (mod.parsedSlug) {
				this.failedQueue?.addModFailure(mod.parsedSlug, 'single_mod_update_exception');
			}
			throw err;
		}
	}

	private async saveModfilesToS3WithTimeout(
		mod: Pick<Mod, 'id' | 'parsedSlug' | 'title' | 'files'>
	): Promise<string[] | null> {
		let timeout: NodeJS.Timeout | null = null;

		try {
			return await Promise.race([
				this.saveModfilesToS3(mod),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => {
						reject(new Error(`Mod files update timeout after ${this.modFilesTimeoutMs}ms`));
					}, this.modFilesTimeoutMs);
				})
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	async saveModfilesToS3(mod: Pick<Mod, 'id' | 'parsedSlug' | 'title' | 'files'>): Promise<string[] | null>;
	async saveModfilesToS3(mod: ParsedMod): Promise<string[] | null>;
	async saveModfilesToS3(
		mod: ParsedMod | Pick<Mod, 'id' | 'parsedSlug' | 'title' | 'files'>
	): Promise<string[] | null> {
		let downloads: Pick<Download, 'file'>[] = [];
		let slug = '';
		let title = '';

		if ('id' in mod) {
			if (!mod.parsedSlug) return null;
			slug = mod.parsedSlug;
			title = mod.title;

			const page = await this.parserGateway.getModPage(slug);
			if (page) {
				const parsed = this.contentParser.parseMod(slug, page.nuxtState);
				downloads = parsed ? parsed.downloads : mod.files.map((f) => ({ file: f }));
			} else {
				downloads = mod.files.map((f) => ({ file: f }));
			}
		} else {
			downloads = mod.downloads;
			slug = mod.slug;
			title = mod.title;
		}

		if (downloads[0]?.file.startsWith('https://api.mcpedl.com')) {
			const relevantsLinks = await this.getRelevantLinks(slug);
			if (relevantsLinks) downloads = relevantsLinks;
		}

		const files: string[] = [];

		const chunkSize = 5;

		for (let i = 0; i < downloads.length; i += chunkSize) {
			const chunk = downloads.slice(i, i + chunkSize);

			await Promise.allSettled(
				chunk.map(async ({ file }) => {
					let s3Url: string | null;

					if (file.startsWith('https://api.mcpedl.com')) {
						s3Url = await this.fileStorage.uploadFromPlaywright(file);
					} else if (file.startsWith('/uploads') || file.startsWith(process.env.S3_PUBLIC_DOMAIN || '')) {
						files.push(file);
						this.progressTracker?.incFilesSkipped();
						return;
					} else {
						s3Url = await this.fileStorage.uploadFromUrl(file, title);
					}

					if (!s3Url && !file.startsWith('/uploads') && !file.startsWith(process.env.S3_PUBLIC_DOMAIN || '')) {
						this.failedQueue?.addFileFailure(slug, file, 'file_upload_failed');
					}

					files.push(s3Url || file);
				})
			);
		}

		return files;
	}

	parseModsFromSearchPage(html: string): ParsedModShort[] {
		return this.contentParser.parseModsFromSearchPage(html);
	}

	parseMod(slug: string, nuxt: any): ParsedMod | null {
		return this.contentParser.parseMod(slug, nuxt);
	}

	async retryFailedItems(options?: {
		resumeFromItemId?: string;
		onCheckpoint?: (itemId: string) => void;
	}): Promise<void> {
		const items = this.failedQueue?.list() || [];
		if (!items.length) {
			logger.info('Очередь failed items пуста.');
			return;
		}

		let processingItems = items;
		if (options?.resumeFromItemId) {
			const index = items.findIndex((item) => item.id === options.resumeFromItemId);
			if (index >= 0) {
				processingItems = items.slice(index + 1);
			}
		}

		const modItems = processingItems.filter((item): item is FailedModItem => item.type === 'mod');
		const fileItems = processingItems.filter((item): item is FailedFileItem => item.type === 'file');
		this.progressTracker?.incModsSeen(modItems.length);

		for (const item of modItems) {
			try {
				await this.retryModItem(item);
				this.failedQueue?.remove(item.id);
				this.progressTracker?.incUpdated();
			} catch (err) {
				const reason = err instanceof Error ? err.message : 'retry_mod_failed';
				this.failedQueue?.markAttempt(item.id, reason);
				this.progressTracker?.incFailed();
				logger.error({ err, slug: item.slug }, 'Не удалось повторно обработать мод');
			} finally {
				options?.onCheckpoint?.(item.id);
			}
		}

		for (const item of fileItems) {
			try {
				await this.retryFileItem(item);
				this.failedQueue?.remove(item.id);
			} catch (err) {
				const reason = err instanceof Error ? err.message : 'retry_file_failed';
				this.failedQueue?.markAttempt(item.id, reason);
				logger.error({ err, slug: item.slug, url: item.url }, 'Не удалось повторно загрузить файл');
			} finally {
				options?.onCheckpoint?.(item.id);
			}
		}
	}

	private async retryModItem(item: FailedModItem): Promise<void> {
		const pageData = await this.parserGateway.getModPage(item.slug);
		if (!pageData) {
			throw new Error('mod_page_unavailable');
		}

		const modData = this.parseMod(item.slug, pageData.nuxtState);
		if (!modData) {
			throw new Error('mod_parse_failed');
		}

		let files: string[] = [];
		if (process.env.SAVE_FILES_DEFAULT == 'true') {
			files = (await this.saveModfilesToS3(modData)) || [];
		} else {
			files = modData.downloads.map((download) => download.file);
		}

		const entity = new ModEntity({
			...modData,
			parsedSlug: item.slug,
			htmlDescription: modData.descriptionHtml,
			files,
			isParsed: true
		});
		entity.setVersions(modData.versions.map((version) => ({ version })));

		const existingMod = await this.modRepository.findBySlug(item.slug);
		if (existingMod) {
			entity.setVersions(entity.versions.concat(existingMod.versions));
			await this.modRepository.update(existingMod.id, entity);
			return;
		}

		await this.modRepository.create(entity);
	}

	private async retryFileItem(item: FailedFileItem): Promise<void> {
		if (item.url.startsWith('https://api.mcpedl.com')) {
			const s3Url = await this.fileStorage.uploadFromPlaywright(item.url);
			if (!s3Url) throw new Error('playwright_file_upload_failed');
			return;
		}

		const s3Url = await this.fileStorage.uploadFromUrl(item.url, item.slug);
		if (!s3Url) throw new Error('file_upload_failed');
	}
}
