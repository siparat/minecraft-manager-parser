import { ConfigService } from './config.service';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { randomUUID } from 'crypto';
import { getS3Config } from '../configs/s3.config';
import { logger } from '../utils/logger';

const DEFAULT_S3_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

const parsePositiveInteger = (value: string | null, fallback: number): number => {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export class S3Service {
	private s3: S3Client;
	private bucketName: string;
	private uploadTimeoutMs: number;

	constructor(private config: ConfigService) {
		this.s3 = new S3Client(getS3Config(config));
		this.bucketName = this.config.getOrThrow('S3_BUCKET_NAME');
		this.uploadTimeoutMs = parsePositiveInteger(config.get('S3_UPLOAD_TIMEOUT_MS'), DEFAULT_S3_UPLOAD_TIMEOUT_MS);
	}

	async uploadFile(body: any, key?: string): Promise<{ Key: string }> {
		const s3Key = key || randomUUID();
		let timeout: NodeJS.Timeout | null = null;
		try {
			const upload = new Upload({
				client: this.s3,
				params: {
					Bucket: this.bucketName,
					Key: s3Key,
					Body: body
				}
			});

			await Promise.race([
				upload.done(),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => {
						const error = new Error(`S3 upload timeout after ${this.uploadTimeoutMs}ms`);
						void Promise.resolve(upload.abort()).catch((err) => {
							logger.error({ err, key: s3Key }, 'S3 upload abort failed');
						});
						if (typeof body?.destroy === 'function') {
							body.destroy(error);
						}
						reject(error);
					}, this.uploadTimeoutMs);
				})
			]);

			return { Key: s3Key };
		} catch (error) {
			logger.error({ err: error, key: s3Key }, 'Ошибка при загрузке файла в S3');
			throw error;
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}
}
