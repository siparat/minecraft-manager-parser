import { chromium } from 'playwright-extra';
import { Page, BrowserContext } from 'playwright';
import { BrowserPageData } from '../interfaces/parser.interface';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from '../services/config.service';
import { logger } from '../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

export class ParserGateway {
	private context: BrowserContext;
	private host: string;

	constructor(private config: ConfigService) {
		this.host = config.getOrThrow('HOST_MODS_API');
	}

	private async getContext(): Promise<BrowserContext> {
		if (!this.context) {
			const userDataDir = path.join(os.tmpdir(), 'playwright_user_data_persistent');

			const headless = this.config.get('BROWSER_HEADLESS') !== 'false';

			this.context = await chromium.launchPersistentContext(userDataDir, {
				headless,

				args: ['--no-sandbox', '--disable-setuid-sandbox'],

				viewport: null,

				userAgent:
					this.config.get('BROWSER_USER_AGENT') ||
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
			});
		}

		return this.context;
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

	async getModSearchPage(pageNumber: number, retries = 3): Promise<string | null> {
		const url = new URL(`page/${pageNumber}`, this.host).toString();

		for (let i = 0; i < retries; i++) {
			const page = await this.createPage();
			try {
				await page.goto(url, {
					waitUntil: 'domcontentloaded',
					timeout: 30000
				});

				if ((await page.title()).includes('Just a moment')) {
					logger.warn({ url }, 'Cloudflare защита обнаружена. Пожалуйста, решите капчу.');
					await page.waitForTimeout(5000);
				}

				await page.waitForSelector('.fancybox.post', {
					timeout: 10000
				});

				return await page.content();
			} catch (e) {
				logger.error({ err: e, url, attempt: i + 1 }, 'Ошибка при запросе страницы поиска');
				if (i === retries - 1) return null;
				await new Promise((resolve) => setTimeout(resolve, 2000));
			} finally {
				await page.close();
			}
		}
		return null;
	}

	async getModPage(slug: string, retries = 3): Promise<BrowserPageData | null> {
		const url = new URL(slug, this.host).toString();

		for (let i = 0; i < retries; i++) {
			const page = await this.createPage();
			try {
				await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

				if ((await page.title()).includes('Just a moment')) {
					logger.warn({ url }, 'Cloudflare защита обнаружена. Пожалуйста, решите капчу.');
					await page.waitForTimeout(5000);
				}

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
				await new Promise((resolve) => setTimeout(resolve, 2000));
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

			if ((await page.title()).includes('Just a moment')) {
				logger.warn({ url }, 'Cloudflare защита обнаружена. Пожалуйста, решите капчу.');
			}

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
	}
}
