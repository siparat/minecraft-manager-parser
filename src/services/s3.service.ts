import { ConfigService } from './config.service';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { randomUUID } from 'crypto';
import { getS3Config } from '../configs/s3.config';
import { logger } from '../utils/logger';

export class S3Service {
	private s3: S3Client;
	private bucketName: string;

	constructor(private config: ConfigService) {
		this.s3 = new S3Client(getS3Config(config));
		this.bucketName = this.config.getOrThrow('S3_BUCKET_NAME');
	}

	async uploadFile(body: any, key?: string): Promise<{ Key: string }> {
		const s3Key = key || randomUUID();
		try {
			const upload = new Upload({
				client: this.s3,
				params: {
					Bucket: this.bucketName,
					Key: s3Key,
					Body: body
				}
			});

			await upload.done();

			return { Key: s3Key };
		} catch (error) {
			logger.error({ err: error, key: s3Key }, 'Ошибка при загрузке файла в S3');
			throw error;
		}
	}
}
