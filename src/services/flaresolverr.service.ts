import { logger } from '../utils/logger';

export interface FlareSolverrCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires?: number;
	size?: number;
	httpOnly?: boolean;
	secure?: boolean;
	session?: boolean;
	sameSite?: string;
}

export interface FlareSolverrSolution {
	url: string;
	status: number;
	cookies: FlareSolverrCookie[];
	userAgent: string;
	response: string;
}

interface FlareSolverrResponse {
	status: 'ok' | 'error';
	message: string;
	session?: string;
	solution?: FlareSolverrSolution;
}

/**
 * Клиент FlareSolverr — прокси, который решает Cloudflare-челлендж ("Just a moment")
 * в собственном браузере и возвращает готовый HTML, cookies (cf_clearance) и userAgent.
 * https://github.com/FlareSolverr/FlareSolverr
 *
 * Использует одну сессию: браузер с уже пройденной защитой переиспользуется между
 * запросами, поэтому капча решается один раз, а последующие запросы идут быстро.
 * Запросы сериализуются — FlareSolverr обрабатывает сессию одним браузером.
 */
export class FlareSolverrService {
	private readonly endpoint: string;
	private readonly maxTimeout: number;

	private sessionId: string | null = null;
	private queue: Promise<unknown> = Promise.resolve();

	constructor(url: string, maxTimeoutMs = 60000) {
		// нормализуем: FlareSolverr слушает /v1
		const base = url.replace(/\/+$/, '');
		this.endpoint = base.endsWith('/v1') ? base : `${base}/v1`;
		this.maxTimeout = maxTimeoutMs;
	}

	/**
	 * Решает Cloudflare-челлендж для URL и возвращает решение (HTML + cookies + userAgent).
	 * Запросы выполняются по одному (общий браузер сессии). Возвращает null при ошибке.
	 */
	async solve(url: string): Promise<FlareSolverrSolution | null> {
		return this.runExclusive(async () => {
			await this.ensureSession();

			let data = await this.requestGet(url);

			// сессия могла протухнуть/быть удалена — пересоздаём один раз
			if ((!data || data.status !== 'ok') && this.sessionId) {
				logger.warn({ url }, 'FlareSolverr: пересоздаём сессию и повторяем запрос');
				this.sessionId = null;
				await this.ensureSession();
				data = await this.requestGet(url);
			}

			if (!data || data.status !== 'ok' || !data.solution) {
				logger.error({ url, message: data?.message }, 'FlareSolverr не смог решить челлендж');
				return null;
			}

			return data.solution;
		});
	}

	/** Завершает сессию FlareSolverr (освобождает браузер). */
	async destroy(): Promise<void> {
		if (!this.sessionId) return;
		const session = this.sessionId;
		this.sessionId = null;
		await this.post({ cmd: 'sessions.destroy', session }).catch(() => null);
	}

	async resetSession(): Promise<void> {
		if (!this.sessionId) return;
		logger.warn({ session: this.sessionId }, 'FlareSolverr: сбрасываем текущую сессию');
		await this.destroy();
	}

	private async ensureSession(): Promise<void> {
		if (this.sessionId) return;
		const res = await this.post({ cmd: 'sessions.create' });
		if (res?.status === 'ok' && res.session) {
			this.sessionId = res.session;
			logger.info({ session: this.sessionId }, 'FlareSolverr сессия создана');
		} else {
			logger.error({ message: res?.message }, 'Не удалось создать сессию FlareSolverr');
		}
	}

	private async requestGet(url: string): Promise<FlareSolverrResponse | null> {
		return this.post({
			cmd: 'request.get',
			url,
			session: this.sessionId || undefined,
			maxTimeout: this.maxTimeout
		});
	}

	private async post(body: Record<string, unknown>): Promise<FlareSolverrResponse | null> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.maxTimeout + 15000);

		try {
			const res = await fetch(this.endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: controller.signal
			});

			if (!res.ok) {
				logger.error({ status: res.status, cmd: body.cmd }, 'FlareSolverr вернул HTTP-ошибку');
				return null;
			}

			return (await res.json()) as FlareSolverrResponse;
		} catch (e) {
			logger.error({ err: e, cmd: body.cmd }, 'Ошибка обращения к FlareSolverr');
			return null;
		} finally {
			clearTimeout(timeout);
		}
	}

	/** Сериализует запросы: FlareSolverr обрабатывает сессию одним браузером. */
	private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.queue.then(fn, fn);
		this.queue = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}
}
