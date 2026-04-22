import { Download, ParsedMod, ParsedModShort } from '../interfaces/mod.interface';
import { ParserGateway } from '../gateways/parser.gateway';
import { ModRepository } from '../repositories/mod.repository';
import { ModEntity } from '../entities/mod.entity';
import { ContentParserService } from './content-parser.service';
import { FileStorageService } from './file-storage.service';
import { FailedFileItem, FailedModItem, FailedQueueService } from './failed-queue.service';
import { ProgressTrackerService } from './progress-tracker.service';
import { logger } from '../utils/logger';
import { Mod } from 'generated/prisma';

export class ParserService {
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
				const files = await this.saveModfilesToS3(mod);

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

	async retryFailedItems(): Promise<void> {
		const items = this.failedQueue?.list() || [];
		if (!items.length) {
			logger.info('Очередь failed items пуста.');
			return;
		}

		const modItems = items.filter((item): item is FailedModItem => item.type === 'mod');
		const fileItems = items.filter((item): item is FailedFileItem => item.type === 'file');
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
