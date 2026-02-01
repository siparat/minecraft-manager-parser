import pLimit from 'p-limit';
import * as fs from 'fs';
import * as path from 'path';
import { ParserStatus } from '../constants/parser.constants';
import { ParserGateway } from '../gateways/parser.gateway';
import { ParserService } from './parser.service';
import { ModRepository } from '../repositories/mod.repository';
import { ModEntity } from '../entities/mod.entity';
import { ModWithVersions } from '../interfaces/mod.interface';
import { logger } from '../utils/logger';

export class ScraperOrchestratorService {
	private page: number = 1;
	private status: ParserStatus = ParserStatus.STOPPED;
	private limit = pLimit(3);
	private progressFile = path.join(process.cwd(), 'parser-progress.json');

	constructor(
		private parserGateway: ParserGateway,
		private parserService: ParserService,
		private modRepository: ModRepository
	) {
		this.loadProgress();
	}

	private loadProgress(): void {
		if (fs.existsSync(this.progressFile)) {
			try {
				const data = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
				this.page = data.lastPage || 1;
				logger.info(`Загружен прогресс: начинаем с ${this.page} страницы`);
			} catch (e) {
				logger.error({ err: e }, 'Ошибка при загрузке файла прогресса');
			}
		}
	}

	private saveProgress(): void {
		try {
			fs.writeFileSync(this.progressFile, JSON.stringify({ lastPage: this.page }), 'utf8');
		} catch (e) {
			logger.error({ err: e }, 'Ошибка при сохранении прогресса');
		}
	}

	async start(startPage?: number): Promise<void> {
		if (this.status === ParserStatus.STARTED) {
			logger.warn('Парсер уже запущен');
			return;
		}

		this.status = ParserStatus.STARTED;
		this.page = startPage || this.page;

		logger.info(`Парсер начинает работу с ${this.page} страницы`);

		try {
			while (this.status === ParserStatus.STARTED) {
				const success = await this.processPage(this.page);
				if (!success) {
					logger.info('Не удалось обработать страницу или контент закончился. Остановка.');
					this.status = ParserStatus.STOPPED;
					break;
				}
				this.saveProgress();
				this.page++;
			}
		} catch (error) {
			logger.error({ err: error }, 'Критическая ошибка в цикле парсинга');
			this.status = ParserStatus.STOPPED;
		}

		logger.info('Парсер закончил работу');
	}

	stop(): void {
		this.status = ParserStatus.STOPPED;
		logger.info('Запрошена остановка парсера...');
	}

	private async processPage(pageNumber: number): Promise<boolean> {
		const html = await this.parserGateway.getModSearchPage(pageNumber);
		if (!html) return false;

		const shortMods = this.parserService.parseModsFromSearchPage(html);
		if (!shortMods || shortMods.length === 0) return false;

		const allSlugs = await this.modRepository.getModSlugs();

		const tasks = shortMods.map((shortMod) =>
			this.limit(async () => {
				if (this.status !== ParserStatus.STARTED) return;

				const { slug } = shortMod;
				try {
					const pageData = await this.parserGateway.getModPage(slug);
					if (!pageData) return;

					const modData = this.parserService.parseMod(slug, pageData.nuxtState);
					if (!modData) return;

					let files: string[] = [];

					if (process.env.SAVE_FILES_DEFAULT == 'true') {
						files = (await this.parserService.saveModfilesToS3(modData)) || [];
					} else {
						files = modData.downloads.map((d) => d.file);
					}

					const entity = new ModEntity({
						...modData,
						parsedSlug: slug,
						htmlDescription: modData.descriptionHtml,
						files,
						isParsed: true
					});
					entity.setVersions(modData.versions.map((version) => ({ version })));

					if (allSlugs.includes(slug)) {
						const existingMod = (await this.modRepository.findBySlug(slug)) as ModWithVersions;
						entity.setVersions(entity.versions.concat(existingMod.versions));

						await this.modRepository.update(existingMod.id, entity);
						logger.info(`Мод ${slug} обновлен`);
					} else {
						await this.modRepository.create(entity);
						logger.info(`Мод ${slug} добавлен`);
					}
				} catch (e) {
					logger.error({ err: e, slug }, 'Ошибка при обработке мода');
				}
			})
		);

		await Promise.all(tasks);

		return true;
	}
}
