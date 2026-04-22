import { Download, ParsedMod, ParsedModShort } from '../interfaces/mod.interface';
import { ParserGateway } from '../gateways/parser.gateway';
import { ModRepository } from '../repositories/mod.repository';
import { ContentParserService } from './content-parser.service';
import { FileStorageService } from './file-storage.service';
import { ProgressTrackerService } from './progress-tracker.service';
import { logger } from '../utils/logger';
import { Mod } from 'generated/prisma';

export class ParserService {
	constructor(
		private parserGateway: ParserGateway,
		private modRepository: ModRepository,
		private contentParser: ContentParserService,
		private fileStorage: FileStorageService,
		private progressTracker?: ProgressTrackerService
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
}
