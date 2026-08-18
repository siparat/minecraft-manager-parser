import { ConfigService } from './services/config.service';
import { ParserGateway } from './gateways/parser.gateway';
import { ParserService } from './services/parser.service';
import { S3Service } from './services/s3.service';
import { ModRepository } from './repositories/mod.repository';
import { ContentParserService } from './services/content-parser.service';
import { FileStorageService } from './services/file-storage.service';
import { ScraperOrchestratorService } from './services/scraper-orchestrator.service';
import { FailedQueueService } from './services/failed-queue.service';
import { ProgressTrackerService } from './services/progress-tracker.service';
import { RunMode, RunStateService } from './services/run-state.service';
import inquirer from 'inquirer';
import { logger } from './utils/logger';
import { PrismaClient } from '../generated/prisma';

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
			type: 'select',
			name: 'action',
			message: '❓ Для какого аккаунта парсить?',
			choices: [
				{ name: '🟢 Первый (youlovehamit.kz)', value: 1 },
				{ name: '🔴 Второй (l13dev.ru)', value: 2 },
				{ name: '🟡 Третий (addonsmcpe.ru)', value: 3 },
				{ name: '🔵 Четвертый (mcmoddev.ru)', value: 4 }
			]
		}
	]);

	switch (action) {
		case 1:
			return config.getOrThrow('FIRST_DATABASE_URL');
		case 2:
			return config.getOrThrow('SECOND_DATABASE_URL');
		case 3:
			return config.getOrThrow('THIRD_DATABASE_URL');
		case 4:
			return config.getOrThrow('FOURTH_DATABASE_URL');
		default:
			throw new Error('URL Базы данных не найдена');
	}
};

const getSingleModSelector = async (modRepository: ModRepository): Promise<{ id: number }> => {
	const { type } = await inquirer.prompt([
		{
			type: 'select',
			name: 'type',
			message: 'Как найти мод для обновления файлов?',
			choices: [
				{ name: 'По точному названию', value: 'name' },
				{ name: 'По id', value: 'id' }
			]
		}
	]);

	if (type === 'name') {
		const { name } = await inquirer.prompt([
			{
				type: 'input',
				name: 'name',
				message: 'Введите точное название мода',
				validate: (value: string): true | string => (value?.trim() ? true : 'name не может быть пустым')
			}
		]);

		const mods = await modRepository.getByName(name);

		if (mods.length === 0) {
			throw new Error('Мод с таким названием не найден');
		}

		if (mods.length == 1) {
			return { id: mods[0].id };
		}

		const { id } = await inquirer.prompt([
			{
				type: 'select',
				name: 'id',
				message: 'Выберите мод',
				choices: mods.map((mod) => ({ name: `${mod.title} (id: ${mod.id}, оценка: ${mod.rating})`, value: mod.id }))
			}
		]);

		return { id };
	}

	const { id } = await inquirer.prompt([
		{
			type: 'number',
			name: 'id',
			message: 'Введите id мода',
			validate: (value: number): true | string =>
				Number.isInteger(value) && value > 0 ? true : 'ID должен быть положительным целым числом'
		}
	]);

	return { id };
};

const askResume = async (mode: RunMode, runStateService: RunStateService): Promise<boolean> => {
	const state = runStateService.getState();
	if (!state || state.mode !== mode) return false;
	if (state.status !== 'running' && state.status !== 'crashed') return false;

	const { resume } = await inquirer.prompt([
		{
			type: 'confirm',
			name: 'resume',
			message: `Найдено незавершенное состояние для ${mode}. Продолжить с последнего места?`,
			default: true
		}
	]);

	return Boolean(resume);
};

export const bootstrap = async (): Promise<void> => {
	const config = new ConfigService();
	const gateway = new ParserGateway(config);
	const s3Service = new S3Service(config);

	const databaseUrl = await getUrlDatabase(config);

	const prismaClient = new PrismaClient({ datasourceUrl: databaseUrl });
	const modRepository = new ModRepository(prismaClient);
	const failedQueue = new FailedQueueService();
	const runStateService = new RunStateService();

	const progressIntervalMs = Number(config.get('PROGRESS_INTERVAL_MS')) || 3000;
	const progressTracker = new ProgressTrackerService(progressIntervalMs);
	const contentParser = new ContentParserService();
	const fileStorage = new FileStorageService(s3Service, gateway, config, progressTracker);
	const service = new ParserService(gateway, modRepository, contentParser, fileStorage, progressTracker, failedQueue);

	const orchestrator = new ScraperOrchestratorService(gateway, service, modRepository, progressTracker, failedQueue);

	const { action } = await inquirer.prompt([
		{
			type: 'select',
			name: 'action',
			message: 'Что вы хотите сделать?',
			choices: [
				{ name: '🚀 Запустить парсер модов (Scraper)', value: 'scrape' },
				{ name: '🔄 Обновить файлы в S3 (для существующих модов)', value: 'update-s3' },
				{ name: '🎯 Обновить файлы конкретного мода', value: 'update-single-mod-files' },
				{ name: '♻️ Повторить файлы и моды после ошибки', value: 'retry-failed' },
				{ name: '❌ Выход', value: 'exit' }
			]
		}
	]);

	switch (action) {
		case 'scrape':
			await (async (): Promise<void> => {
				const shouldResume = await askResume('scrape', runStateService);
				const state = runStateService.getState();
				const startPage = shouldResume ? state?.checkpoint.page : await getStartPage();
				runStateService.start('scrape', { page: startPage || 1 });
				try {
					await orchestrator.start(startPage, (page) => runStateService.checkpoint({ page }));
					runStateService.complete();
				} catch (err) {
					const message = err instanceof Error ? err.message : 'scrape_crashed';
					runStateService.crash(message);
					throw err;
				}
			})();
			break;
		case 'update-s3':
			logger.info('Начинаем обновление файлов в S3...');
			progressTracker.start('UPDATE-S3');
			try {
				const shouldResume = await askResume('update-s3', runStateService);
				const state = runStateService.getState();
				const resumeFromModId = shouldResume ? state?.checkpoint.modId : undefined;
				runStateService.start('update-s3', { modId: resumeFromModId });
				await service.updateModfilesInS3WithResume({
					resumeFromModId,
					onCheckpoint: (modId) => runStateService.checkpoint({ modId })
				});
				runStateService.complete();
			} catch (err) {
				const message = err instanceof Error ? err.message : 'update_s3_crashed';
				runStateService.crash(message);
				throw err;
			} finally {
				progressTracker.stop();
			}
			logger.info('Обновление файлов завершено.');
			break;
		case 'update-single-mod-files':
			try {
				const { id } = await getSingleModSelector(modRepository);
				logger.info('Запускаем обновление файлов у конкретного мода...');
				progressTracker.start('UPDATE-SINGLE-MOD');
				await service.updateSingleModFiles({ id });
			} finally {
				progressTracker.stop();
			}
			logger.info('Обновление файлов конкретного мода завершено.');
			break;
		case 'retry-failed':
			logger.info('Запускаем повторную обработку модов после ошибки...');
			progressTracker.start('RETRY-FAILED');
			try {
				await service.retryFailedItems();
			} finally {
				progressTracker.stop();
			}
			logger.info('Повторная обработка модов после ошибки завершена.');
			break;
		case 'exit':
			console.log('Выход.');
			process.exit(0);
	}
};

bootstrap();
