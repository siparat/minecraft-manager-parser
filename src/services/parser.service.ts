import { Download, ParsedMod, ParsedModShort } from '../interfaces/mod.interface';
import { ParserGateway } from '../gateways/parser.gateway';
import { ModRepository } from '../repositories/mod.repository';
import { ContentParserService } from './content-parser.service';
import { FileStorageService } from './file-storage.service';
import { Mod } from 'generated/prisma';

export class ParserService {
	constructor(
		private parserGateway: ParserGateway,
		private modRepository: ModRepository,
		private contentParser: ContentParserService,
		private fileStorage: FileStorageService
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

		for (const mod of mods) {
			const files = await this.saveModfilesToS3(mod);

			if (files) {
				await this.modRepository.updateFiles(mod.id, files);
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
			if (mod.files.every((v) => v.startsWith(process.env.S3_PUBLIC_DOMAIN || '') && !v.match(/[0-9a-fA-F-]{36}/))) {
				return mod.files;
			}
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

		await Promise.allSettled(
			downloads.map(async ({ file }) => {
				let s3Url: string | null;
				if (file.startsWith('https://api.mcpedl.com')) {
					s3Url = await this.fileStorage.uploadFromPlaywright(file);
				} else if (file.startsWith('/uploads') || file.startsWith(process.env.S3_PUBLIC_DOMAIN || '')) {
					files.push(file);
					return;
				} else {
					s3Url = await this.fileStorage.uploadFromUrl(file, title);
				}

				if (s3Url) {
					files.push(s3Url);
				} else {
					files.push(file);
				}
			})
		);

		return files;
	}

	parseModsFromSearchPage(html: string): ParsedModShort[] {
		return this.contentParser.parseModsFromSearchPage(html);
	}

	parseMod(slug: string, nuxt: any): ParsedMod | null {
		return this.contentParser.parseMod(slug, nuxt);
	}
}
