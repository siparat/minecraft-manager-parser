import { PrismaClient } from '../generated/prisma';
import { ConfigService } from './services/config.service';
import { ParserGateway } from './gateways/parser.gateway';
import { ParserService } from './services/parser.service';
import { S3Service } from './services/s3.service';
import { ModRepository } from './repositories/mod.repository';
import { ContentParserService } from './services/content-parser.service';
import { FileStorageService } from './services/file-storage.service';
import { ScraperOrchestratorService } from './services/scraper-orchestrator.service';
import { ProgressTrackerService } from './services/progress-tracker.service';
import inquirer from 'inquirer';
import { logger } from './utils/logger';

const getStartPage = async (): Promise<number | undefined> => {
	const { startPage } = await inquirer.prompt({
		type: 'number',
		name: 'startPage',
		message: 'С какой страницы начать? (введите 0, чтобы продолжить на которой остановились)'
	});
	return startPage ? (startPage == 0 ? undefined : startPage) : undefined;
};

const getUrlDatabase = async (config: ConfigService): Promise<string> => {
	const { action } = await inquirer.prompt([
		{
			type: 'list',
			name: 'action',
			message: '❓ Для какого аккаунта парсить?',
			choices: [
				{ name: '🟢 Первый', value: 1 },
				{ name: '🔴 Второй', value: 2 }
			]
		}
	]);

	switch (action) {
		case 1:
			return config.getOrThrow('FIRST_DATABASE_URL');
		case 2:
			return config.getOrThrow('SECOND_DATABASE_URL');
		default:
			throw new Error('URL Базы данных не найдена');
	}
};

export const bootstrap = async (): Promise<void> => {
	const config = new ConfigService();
	const gateway = new ParserGateway(config);
	const s3Service = new S3Service(config);

	const databaseUrl = await getUrlDatabase(config);

	const prismaClient = new PrismaClient({ datasourceUrl: databaseUrl });
	const modRepository = new ModRepository(prismaClient);

	const progressIntervalMs = Number(config.get('PROGRESS_INTERVAL_MS')) || 3000;
	const progressTracker = new ProgressTrackerService(progressIntervalMs);

	const contentParser = new ContentParserService();
	const fileStorage = new FileStorageService(s3Service, gateway, config, progressTracker);
	const service = new ParserService(gateway, modRepository, contentParser, fileStorage, progressTracker);

	const orchestrator = new ScraperOrchestratorService(gateway, service, modRepository, progressTracker);

	const { action } = await inquirer.prompt([
		{
			type: 'list',
			name: 'action',
			message: 'Что вы хотите сделать?',
			choices: [
				{ name: '🚀 Запустить парсер модов (Scraper)', value: 'scrape' },
				{ name: '🔄 Обновить файлы в S3 (для существующих модов)', value: 'update-s3' },
				{ name: '❌ Выход', value: 'exit' }
			]
		}
	]);

	switch (action) {
		case 'scrape':
			await orchestrator.start(await getStartPage());
			break;
		case 'update-s3':
			logger.info('Начинаем обновление файлов в S3...');
			progressTracker.start('UPDATE-S3');
			try {
				await service.updateModfilesInS3();
			} finally {
				progressTracker.stop();
			}
			logger.info('Обновление файлов завершено.');
			break;
		case 'exit':
			console.log('Выход.');
			process.exit(0);
	}
};

bootstrap();
