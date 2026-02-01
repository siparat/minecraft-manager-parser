import 'dotenv/config';

export class ConfigService {
	get(key: string): string | null {
		return process.env[key] || null;
	}
	getOrThrow(key: string): string {
		const value = process.env[key];
		if (!value) {
			throw new Error(`Ключ ${key} не найден в окружении`);
		}
		return value;
	}
}
