import { ModTranslation } from '../../generated/prisma';

export class ModTranslationEntity {
	modId: number;
	languageId: number;
	description: string;

	constructor(translation: Omit<ModTranslation, 'id'>) {
		this.description = translation.description;
		this.languageId = translation.languageId;
		this.modId = translation.modId;
	}
}
