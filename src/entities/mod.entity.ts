import { ModCategory, ModTranslation, ModVersion } from '../../generated/prisma';
import { IModEntity } from '../interfaces/mod-entity.interface';
import { ModTranslationEntity } from './mod-translation.entity';

export class ModEntity implements IModEntity {
	id?: number;
	parsedSlug?: string;
	category: ModCategory;
	htmlDescription?: string;
	createdAt?: Date;
	updatedAt?: Date;
	isParsed?: boolean;
	commentCounts?: number;
	rating?: number;
	descriptionImages: string[];
	title: string;
	description: string;
	image: string;
	files: string[];
	versions: ModVersion[];
	translations: ModTranslationEntity[];

	constructor(mod: IModEntity) {
		this.id = mod.id;
		this.createdAt = mod.createdAt;
		this.updatedAt = mod.updatedAt;
		this.title = mod.title;
		this.category = mod.category;
		this.commentCounts = mod.commentCounts ?? undefined;
		this.rating = mod.rating ?? undefined;
		this.description = mod.description;
		this.image = mod.image;
		this.files = mod.files;
		this.isParsed = mod.isParsed || undefined;
		this.parsedSlug = mod.parsedSlug || undefined;
		this.htmlDescription = mod.htmlDescription || undefined;
		this.descriptionImages = mod.descriptionImages || [];
		this.versions = [];
		this.translations = [];
	}

	setVersions(versions: ModVersion[]): this {
		this.versions = versions;
		return this;
	}

	setTranslations(translations: ModTranslation[]): this {
		this.translations = translations;
		return this;
	}
}
