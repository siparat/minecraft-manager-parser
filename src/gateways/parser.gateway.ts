import { chromium } from 'playwright-extra';
import { Page, BrowserContext, Cookie } from 'playwright';
import { BrowserPageData } from '../interfaces/parser.interface';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { ConfigService } from '../services/config.service';
import { FlareSolverrService, FlareSolverrCookie, FlareSolverrSolution } from '../services/flaresolverr.service';
import { logger } from '../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

export class ParserGateway {
	private context: BrowserContext;
	private host: string;

	private flareSolverr: FlareSolverrService | null = null;
	// userAgent/cookies от FlareSolverr — нужны только для скачивания файлов через Playwright.
	private flareUserAgent: string | null = null;
	private flareCookies: FlareSolverrCookie[] = [];
	private solving: Promise<boolean> | null = null;

	constructor(private config: ConfigService) {
		this.host = config.getOrThrow('HOST_MODS_API');

		const flareUrl = config.get('FLARESOLVERR_URL');
		if (flareUrl) {
			const maxTimeout = Number(config.get('FLARESOLVERR_MAX_TIMEOUT')) || 60000;
			this.flareSolverr = new FlareSolverrService(flareUrl, maxTimeout);
			logger.info({ endpoint: flareUrl }, 'FlareSolverr включён для обхода Cloudflare');
		}
	}

	async getModSearchPage(pageNumber: number, retries = 3): Promise<string | null> {
		const url = new URL(`search/?page=${pageNumber}`, this.host).toString();

		if (this.flareSolverr) {
			const html = await this.getModSearchPageViaFlare(url, retries);
			if (html) return html;

			logger.warn({ url }, 'FlareSolverr не вернул страницу поиска, пробуем Playwright fallback');
		}

		return this.getModSearchPageViaPlaywright(url, retries);
	}

	async getModPage(slug: string, retries = 3): Promise<BrowserPageData | null> {
		const url = new URL(slug, this.host).toString();

		if (this.flareSolverr) {
			const page = await this.getModPageViaFlare(url, slug, retries);
			if (page) return page;

			logger.warn({ slug, url }, 'FlareSolverr не вернул страницу мода, пробуем Playwright fallback');
		}

		return this.getModPageViaPlaywright(url, slug, retries);
	}

	// ─────────────────────────── FlareSolverr ───────────────────────────

	private async getModSearchPageViaFlare(url: string, retries: number): Promise<string | null> {
		for (let i = 0; i < retries; i++) {
			const solution = await this.flareSolverr!.solve(url);

			if (solution && this.isUsableFlareSolution(solution)) {
				return solution.response;
			}

			logger.error(
				{ url, attempt: i + 1, status: solution?.status },
				'FlareSolverr: не удалось получить страницу поиска'
			);
			if (i === retries - 1) return null;
			await this.resetFlareSessionIfNeeded(solution);
			await this.delay(2000);
		}
		return null;
	}

	private async getModPageViaFlare(url: string, slug: string, retries: number): Promise<BrowserPageData | null> {
		for (let i = 0; i < retries; i++) {
			const solution = await this.flareSolverr!.solve(url);

			if (solution && this.isUsableFlareSolution(solution)) {
				const nuxtState = this.extractNuxtState(solution.response);
				if (nuxtState) {
					return { html: solution.response, nuxtState };
				}
			}

			logger.error(
				{ slug, attempt: i + 1, status: solution?.status },
				'FlareSolverr: не удалось получить страницу мода'
			);
			if (i === retries - 1) return null;
			await this.resetFlareSessionIfNeeded(solution);
			await this.delay(2000);
		}
		return null;
	}

	private isUsableFlareSolution(solution: FlareSolverrSolution): boolean {
		if (!solution.response) return false;
		return solution.status >= 200 && solution.status < 400 && !this.isChallengePage(solution.response);
	}

	private async resetFlareSessionIfNeeded(solution: FlareSolverrSolution | null): Promise<void> {
		if (!solution || solution.status >= 400 || this.isChallengePage(solution.response)) {
			await this.flareSolverr?.resetSession();
		}
	}

	private isChallengePage(html: string): boolean {
		return /<title>\s*Just a moment|cf-browser-verification|cf-mitigated|challenges\.cloudflare\.com|Cloudflare Ray ID/i.test(
			html
		);
	}

	/**
	 * Извлекает объект window.__NUXT__ из готового HTML. FlareSolverr отдаёт HTML
	 * с инлайновым скриптом `window.__NUXT__=(function(){...}())`, который мы
	 * вычисляем в изолированном контексте vm.
	 */
	private extractNuxtState(html: string): unknown | null {
		const match = html.match(/\bwindow\.__NUXT__\s*=/);
		if (!match || typeof match.index !== 'number') return null;

		const from = match.index + match[0].length;
		const end = html.indexOf('</script>', from);
		if (end === -1) return null;

		let expr = html.slice(from, end).trim();
		if (expr.endsWith(';')) expr = expr.slice(0, -1);

		try {
			const sandbox: { window: { __NUXT__?: unknown } } = { window: {} };
			vm.createContext(sandbox);
			vm.runInContext(`window.__NUXT__=${expr}`, sandbox, { timeout: 5000 });
			return sandbox.window.__NUXT__ ?? null;
		} catch (e) {
			logger.error({ err: e }, 'Не удалось извлечь __NUXT__ из HTML FlareSolverr');
			return null;
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	// ─────────────────────────── Playwright (fallback + скачивание) ───────────────────────────

	private async getContext(): Promise<BrowserContext> {
		if (!this.context) {
			// Для скачивания файлов через Playwright пытаемся получить cookies FlareSolverr
			// (обход Cloudflare на api.mcpedl.com). Это best-effort — cf_clearance привязан
			// к отпечатку браузера, поэтому может не сработать.
			if (this.flareSolverr && !this.flareUserAgent) {
				await this.solveChallenge();
			}

			const userDataDir = path.join(os.tmpdir(), 'playwright_user_data_persistent');
			const headless = this.config.get('BROWSER_HEADLESS') !== 'false';

			this.context = await chromium.launchPersistentContext(userDataDir, {
				headless,
				args: ['--no-sandbox', '--disable-setuid-sandbox'],
				viewport: null,
				userAgent:
					this.flareUserAgent ||
					this.config.get('BROWSER_USER_AGENT') ||
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
			});

			await this.applyFlareCookies();
		}

		return this.context;
	}

	private toPlaywrightCookies(cookies: FlareSolverrCookie[]): Cookie[] {
		const mapSameSite = (value?: string): 'Strict' | 'Lax' | 'None' => {
			switch ((value || '').toLowerCase()) {
				case 'strict':
					return 'Strict';
				case 'none':
				case 'no_restriction':
					return 'None';
				default:
					return 'Lax';
			}
		};

		return cookies.map((c) => {
			const sameSite = mapSameSite(c.sameSite);
			return {
				name: c.name,
				value: c.value,
				domain: c.domain,
				path: c.path || '/',
				expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : -1,
				httpOnly: Boolean(c.httpOnly),
				// Playwright требует secure=true для sameSite=None
				secure: sameSite === 'None' ? true : Boolean(c.secure),
				sameSite
			} as Cookie;
		});
	}

	private async applyFlareCookies(): Promise<void> {
		if (!this.context || this.flareCookies.length === 0) return;
		try {
			await this.context.addCookies(this.toPlaywrightCookies(this.flareCookies));
		} catch (e) {
			logger.error({ err: e }, 'Не удалось внедрить cookies FlareSolverr в контекст');
		}
	}

	private async solveChallenge(): Promise<boolean> {
		if (!this.flareSolverr) return false;
		if (this.solving) return this.solving;

		this.solving = (async (): Promise<boolean> => {
			const solution = await this.flareSolverr!.solve(this.host);
			if (!solution) return false;

			this.flareUserAgent = solution.userAgent;
			this.flareCookies = solution.cookies;
			await this.applyFlareCookies();
			return true;
		})();

		try {
			return await this.solving;
		} finally {
			this.solving = null;
		}
	}

	private async createPage(): Promise<Page> {
		const context = await this.getContext();
		const page = await context.newPage();

		await page.setExtraHTTPHeaders({
			'Accept-Language': 'en-US,en;q=0.9'
		});

		await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf,css}', (route) => {
			route.abort();
		});

		return page;
	}

	private async handlePlaywrightChallenge(page: Page, url: string): Promise<void> {
		if (!(await page.title()).includes('Just a moment')) return;

		logger.warn({ url }, 'Cloudflare защита обнаружена');

		if (this.flareSolverr) {
			const ok = await this.solveChallenge();
			if (ok) {
				await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
				return;
			}
		}

		await page.waitForTimeout(5000);
	}

	private async getModSearchPageViaPlaywright(url: string, retries: number): Promise<string | null> {
		for (let i = 0; i < retries; i++) {
			const page = await this.createPage();
			try {
				await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
				await this.handlePlaywrightChallenge(page, url);

				await page.waitForSelector('.fancybox.post', { timeout: 10000 });

				return await page.content();
			} catch (e) {
				logger.error({ err: e, url, attempt: i + 1 }, 'Ошибка при запросе страницы поиска');
				if (i === retries - 1) return null;
				await this.delay(2000);
			} finally {
				await page.close();
			}
		}
		return null;
	}

	private async getModPageViaPlaywright(url: string, slug: string, retries: number): Promise<BrowserPageData | null> {
		for (let i = 0; i < retries; i++) {
			const page = await this.createPage();
			try {
				await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
				await this.handlePlaywrightChallenge(page, url);

				await page.waitForFunction(() => (window as any).__NUXT__, { timeout: 10000 });

				const data = await page.evaluate(() => {
					return {
						html: document.documentElement.outerHTML,
						nuxtState: (window as any).__NUXT__
					};
				});

				return data;
			} catch (e) {
				logger.error({ err: e, slug, attempt: i + 1 }, 'Ошибка парсинга страницы мода');
				if (i === retries - 1) return null;
				await this.delay(2000);
			} finally {
				await page.close();
			}
		}
		return null;
	}

	async downloadFile(url: string): Promise<{ savePath: string; filename: string } | null> {
		const page = await this.createPage();
		try {
			const downloadPromise = page.waitForEvent('download', { timeout: 60000 });

			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
			await this.handlePlaywrightChallenge(page, url).catch(() => {});

			const download = await downloadPromise;
			const savePath = await download.path();
			if (!savePath) return null;

			const filename = download.suggestedFilename();

			return { savePath, filename };
		} catch (e) {
			logger.error({ err: e, url }, 'Ошибка скачивания файла через Playwright');
			return null;
		} finally {
			await page.close();
		}
	}

	async onModuleDestroy(): Promise<void> {
		if (this.context) {
			await this.context.close();
		}
		if (this.flareSolverr) {
			await this.flareSolverr.destroy();
		}
	}
}
