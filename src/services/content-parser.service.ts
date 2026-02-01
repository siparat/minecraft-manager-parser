import { JSDOM } from 'jsdom';
import { ParsedMod, ParsedModShort } from '../interfaces/mod.interface';
import { parseCategory } from '../utils/parse-category.util';

export class ContentParserService {
	parseModsFromSearchPage(html: string): ParsedModShort[] {
		const { window } = new JSDOM(html);
		const cards = window.document.querySelectorAll('.fancybox.post');
		const mods = Array.from(cards).map((card) => this.handleModCard(card));
		return mods.filter(Boolean) as ParsedModShort[];
	}

	parseMod(slug: string, nuxt: any): ParsedMod | null {
		const model = nuxt?.state?.slug?.model;
		if (!model?.title) return null;

		const category = parseCategory(model.categories || []);
		if (!category) return null;

		const downloads = model.downloads || [];
		const filteredDownloads = Array.from(new Map(downloads.map((d: any) => [d.file, d])).values()) as any[];

		if (filteredDownloads.some((d) => d.file.startsWith('/leaving'))) {
			return null;
		}

		const descriptionHtml = (model.description || '').trim();
		const description = descriptionHtml
			.replace(/<[^>]+>/g, '')
			.replace(/\n{2,}/g, '\n')
			.trim();

		return {
			slug,
			title: model.title,
			image: model.image,
			category,
			downloads: filteredDownloads,
			description,
			descriptionHtml,
			descriptionImages: model.submission_images || [],
			commentCounts: model.comments_total || 0,
			rating: Number(Number(model.comments_rating?.average || 0).toFixed(2)),
			versions: model.minecraft_versions?.map((v: any) => v.name) || [],
			updatedAt: new Date(model.updated_at)
		};
	}

	private handleModCard(card: Element): ParsedModShort | null {
		const slug = card.querySelector<HTMLAnchorElement>('.fancybox__content__title a')?.href.slice(1, -1);
		const title = card.querySelector('.fancybox__content__title')?.textContent;
		const shortDescription = card.querySelector('.fancybox__content__description')?.textContent || undefined;
		const author = card.querySelector('.fancybox__header__content a')?.textContent || undefined;
		const dateString = card
			.querySelector('.fancybox__header__content small')
			?.textContent?.replace('Published on ', '')
			.trim();
		const rating = card.querySelector('.fancybox__header__rating')?.textContent?.trim();
		const image = card.querySelector<HTMLImageElement>('.post__img__static img')?.src;

		if (!slug || !title || !image) {
			return null;
		}

		return {
			slug,
			title,
			shortDescription,
			author,
			publishedAt: dateString ? new Date(dateString) : undefined,
			rating: Number(rating),
			image
		};
	}
}
