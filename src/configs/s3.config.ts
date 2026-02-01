import { S3ClientConfig } from '@aws-sdk/client-s3';
import { ConfigService } from '../services/config.service';

export const getS3Config = (config: ConfigService): S3ClientConfig => ({
	endpoint: config.getOrThrow('S3_ENDPOINT'),
	region: config.getOrThrow('S3_REGION'),
	forcePathStyle: true, // v3 equivalent of s3ForcePathStyle
	credentials: {
		accessKeyId: config.getOrThrow('S3_ACCESS_KEY'),
		secretAccessKey: config.getOrThrow('S3_SECRET_ACCESS_KEY')
	}
});
