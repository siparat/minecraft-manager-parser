import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { Readable } from 'stream';
import { S3Service } from './s3.service';
import { ConfigService } from './config.service';
import { ParserGateway } from '../gateways/parser.gateway';
import { logger } from '../utils/logger';

export class FileStorageService {
	private s3PublicDomain: string;

	constructor(
		private s3Service: S3Service,
		private parserGateway: ParserGateway,
		config: ConfigService
	) {
		this.s3PublicDomain = config.getOrThrow('S3_PUBLIC_DOMAIN');
	}

	async uploadFromUrl(url: string, modTitle?: string): Promise<string | null> {
		try {
			logger.info({ url, modTitle }, 'Начало скачивания файла по URL');
			const response = await fetch(url, { redirect: 'follow' });

			if (response.status !== 200 || !response.body) {
				logger.error({ url, status: response.status, modTitle }, 'Не удалось скачать файл по ссылке');
				return null;
			}

			const s3Key = this.createS3KeyByUrl(url);
			const contentLength = response.headers.get('content-length');

			logger.info({ url, s3Key, size: contentLength }, 'Файл скачан, начало загрузки в S3');

			const stream = Readable.fromWeb(response.body as any);
			const result = await this.s3Service.uploadFile(stream, s3Key);

			logger.info({ key: result.Key }, 'Файл успешно загружен в S3');

			return this.s3PublicDomain + '/' + result.Key;
		} catch (error) {
			logger.error({ err: error, url }, 'Ошибка при загрузке файла по URL');
			return null;
		}
	}

	async uploadFromPlaywright(url: string): Promise<string | null> {
		logger.info({ url }, 'Начало скачивания файла через Playwright');
		const downloadResult = await this.parserGateway.downloadFile(url);
		if (!downloadResult) {
			logger.error({ url }, 'Не удалось скачать файл через Playwright');
			return null;
		}

		try {
			const s3Key = this.createS3KeyByUrl(url, downloadResult.filename);

			const stats = await fs.promises.stat(downloadResult.savePath);
			logger.info({ url, s3Key, size: stats.size }, 'Файл скачан (Playwright), начало загрузки в S3');

			const fileStream = fs.createReadStream(downloadResult.savePath);
			const result = await this.s3Service.uploadFile(fileStream, s3Key);

			await fs.promises.unlink(downloadResult.savePath).catch(() => {});

			logger.info({ key: result.Key }, 'Файл успешно загружен в S3 (Playwright)');

			return this.s3PublicDomain + '/' + result.Key;
		} catch (error) {
			logger.error({ err: error, url }, 'Ошибка при загрузке файла через Playwright');
			return null;
		}
	}

	private createS3KeyByUrl(url: string, filename?: string): string {
		const pathname = new URL(url).pathname.split('/').pop()!;
		const ext = path.extname(new URL(url).pathname) || '.mcpack';

		return `mods/${decodeURI(pathname) || filename || randomUUID() + ext}`;
	}
}
