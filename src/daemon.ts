import 'dotenv/config';
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
import { RunStateService } from './services/run-state.service';
import { logger } from './utils/logger';
import { PrismaClient } from '../generated/prisma';

interface DaemonSettings {
	databaseSource: string;
	cycleDelayMs: number;
	errorDelayMs: number;
	scrapeStartPage: number;
	scrapeEnabled: boolean;
	updateActiveModsEnabled: boolean;
}

interface DaemonRuntime {
	config: ConfigService;
	databaseSource: string;
	gateway: ParserGateway;
	prismaClient: PrismaClient;
	parserService: ParserService;
	orchestrator: ScraperOrchestratorService;
	progressTracker: ProgressTrackerService;
	runStateService: RunStateService;
}

let isShuttingDown = false;
let currentOrchestrator: ScraperOrchestratorService | null = null;
let wakeWait: (() => void) | null = null;

const databaseEnvByAlias: Record<string, string> = {
	'1': 'FIRST_DATABASE_URL',
	first: 'FIRST_DATABASE_URL',
	'2': 'SECOND_DATABASE_URL',
	second: 'SECOND_DATABASE_URL',
	'3': 'THIRD_DATABASE_URL',
	third: 'THIRD_DATABASE_URL'
};

const parseBoolean = (value: string | null, fallback: boolean): boolean => {
	if (value === null) return fallback;
	return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
};

const parsePositiveInteger = (value: string | null, fallback: number): number => {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const getErrorMessage = (err: unknown, fallback: string): string => {
	return err instanceof Error ? err.message : fallback;
};

const getDatabaseUrl = (config: ConfigService): { url: string; source: string } => {
	const directUrl = config.get('DAEMON_DATABASE_URL') || config.get('DATABASE_URL');
	if (directUrl) {
		return { url: directUrl, source: config.get('DAEMON_DATABASE_URL') ? 'DAEMON_DATABASE_URL' : 'DATABASE_URL' };
	}

	const selectedDatabase = (config.get('DAEMON_DATABASE') || 'first').toLowerCase();
	const envKey = databaseEnvByAlias[selectedDatabase];
	if (!envKey) {
		throw new Error(
			`Неизвестное значение DAEMON_DATABASE="${selectedDatabase}". Используйте first/second/third или 1/2/3.`
		);
	}

	return { url: config.getOrThrow(envKey), source: envKey };
};

const getSettings = (config: ConfigService, databaseSource: string): DaemonSettings => ({
	databaseSource,
	cycleDelayMs: parsePositiveInteger(config.get('DAEMON_CYCLE_DELAY_MS'), 60 * 60 * 1000),
	errorDelayMs: parsePositiveInteger(config.get('DAEMON_ERROR_DELAY_MS'), 60 * 1000),
	scrapeStartPage: parsePositiveInteger(config.get('DAEMON_SCRAPE_START_PAGE'), 1),
	scrapeEnabled: parseBoolean(config.get('DAEMON_SCRAPE_ENABLED'), true),
	updateActiveModsEnabled: parseBoolean(config.get('DAEMON_UPDATE_ACTIVE_MODS_ENABLED'), true)
});

const createRuntime = (): DaemonRuntime => {
	const config = new ConfigService();
	const gateway = new ParserGateway(config);
	const { url: databaseUrl, source: databaseSource } = getDatabaseUrl(config);
	const prismaClient = new PrismaClient({ datasourceUrl: databaseUrl });
	const modRepository = new ModRepository(prismaClient);
	const failedQueue = new FailedQueueService();
	const progressIntervalMs = parsePositiveInteger(config.get('PROGRESS_INTERVAL_MS'), 3000);
	const progressTracker = new ProgressTrackerService(progressIntervalMs);
	const s3Service = new S3Service(config);
	const contentParser = new ContentParserService();
	const fileStorage = new FileStorageService(s3Service, gateway, config, progressTracker);
	const parserService = new ParserService(
		gateway,
		modRepository,
		contentParser,
		fileStorage,
		progressTracker,
		failedQueue
	);
	const orchestrator = new ScraperOrchestratorService(
		gateway,
		parserService,
		modRepository,
		progressTracker,
		failedQueue
	);
	const runStateService = new RunStateService('run-state-daemon.json');

	return {
		config,
		databaseSource,
		gateway,
		prismaClient,
		parserService,
		orchestrator,
		progressTracker,
		runStateService
	};
};

const wait = async (ms: number): Promise<void> => {
	if (isShuttingDown) return;

	await new Promise<void>((resolve) => {
		const timer = setTimeout(() => {
			wakeWait = null;
			resolve();
		}, ms);

		wakeWait = (): void => {
			clearTimeout(timer);
			wakeWait = null;
			resolve();
		};
	});
};

const requestShutdown = (): void => {
	if (isShuttingDown) return;

	isShuttingDown = true;
	currentOrchestrator?.stop();
	wakeWait?.();
	logger.warn('Получен сигнал остановки. Завершаем текущую операцию и закрываем ресурсы...');
};

const runScraper = async (runtime: DaemonRuntime, settings: DaemonSettings): Promise<void> => {
	logger.info({ startPage: settings.scrapeStartPage }, 'DAEMON: запускаем scraper');
	runtime.runStateService.start('scrape', { page: settings.scrapeStartPage });

	try {
		currentOrchestrator = runtime.orchestrator;
		await runtime.orchestrator.start(settings.scrapeStartPage, (page) => runtime.runStateService.checkpoint({ page }));
		runtime.runStateService.complete();
	} catch (err) {
		runtime.runStateService.crash(getErrorMessage(err, 'daemon_scrape_crashed'));
		throw err;
	} finally {
		currentOrchestrator = null;
	}
};

const updateActiveMods = async (runtime: DaemonRuntime): Promise<void> => {
	logger.info('DAEMON: обновляем файлы активных модов из базы');
	runtime.progressTracker.start('DAEMON-UPDATE-ACTIVE-MODS');
	runtime.runStateService.start('update-s3');

	try {
		await runtime.parserService.updateModfilesInS3WithResume({
			onCheckpoint: (modId) => runtime.runStateService.checkpoint({ modId })
		});
		runtime.runStateService.complete();
	} catch (err) {
		runtime.runStateService.crash(getErrorMessage(err, 'daemon_update_active_mods_crashed'));
		throw err;
	} finally {
		runtime.progressTracker.stop();
	}
};

const runCycle = async (runtime: DaemonRuntime, settings: DaemonSettings, cycle: number): Promise<void> => {
	logger.info({ cycle }, 'DAEMON: начинаем цикл');

	if (settings.scrapeEnabled && !isShuttingDown) {
		await runScraper(runtime, settings);
	}

	if (settings.updateActiveModsEnabled && !isShuttingDown) {
		await updateActiveMods(runtime);
	}

	logger.info({ cycle }, 'DAEMON: цикл завершён');
};

const bootstrapDaemon = async (): Promise<void> => {
	process.on('SIGINT', requestShutdown);
	process.on('SIGTERM', requestShutdown);

	const runtime = createRuntime();
	const settings = getSettings(runtime.config, runtime.databaseSource);
	let cycle = 1;

	logger.info(settings, 'Круглосуточный daemon парсера запущен');

	try {
		while (!isShuttingDown) {
			try {
				await runCycle(runtime, settings, cycle);
				cycle++;

				if (!isShuttingDown) {
					logger.info({ delayMs: settings.cycleDelayMs }, 'DAEMON: ждём перед следующим циклом');
					await wait(settings.cycleDelayMs);
				}
			} catch (err) {
				logger.error({ err }, 'DAEMON: цикл завершился с ошибкой');

				if (!isShuttingDown) {
					logger.info({ delayMs: settings.errorDelayMs }, 'DAEMON: ждём перед повтором после ошибки');
					await wait(settings.errorDelayMs);
				}
			}
		}
	} finally {
		await runtime.gateway.onModuleDestroy();
		await runtime.prismaClient.$disconnect();
		logger.info('Круглосуточный daemon парсера остановлен');
	}
};

bootstrapDaemon().catch((err) => {
	logger.error({ err }, 'DAEMON: критическая ошибка запуска');
	process.exit(1);
});
