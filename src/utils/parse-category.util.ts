import { ModCategory } from '../../generated/prisma';

export const parseCategory = (categories: { slug: string }[]): ModCategory | null => {
	for (const { slug } of categories) {
		switch (true) {
			case slug.includes('skin'):
				return ModCategory.SKIN_PACK;
			case slug.includes('mods') || slug.includes('addons'):
				return ModCategory.ADDON;
			case slug.includes('maps'):
				return ModCategory.WORLD;
			case slug.includes('texture'):
				return ModCategory.TEXTURE_PACK;
		}
	}
	return null;
};
