import { Mod, PrismaClient } from '../../generated/prisma';
import { ModEntity } from '../entities/mod.entity';
import { ModWithVersions } from '../interfaces/mod.interface';

export class ModRepository {
	constructor(private database: PrismaClient) {}

	async findUsedMods(): Promise<Mod[]> {
		return this.database.mod.findMany({
			where: {
				apps: { some: {} }
			}
		});
	}

	async updateFiles(id: number, files: string[]): Promise<Mod> {
		try {
			return await this.database.mod.update({
				where: { id },
				data: { files }
			});
		} catch (error) {
			console.error(error);
			throw new Error('Произошла непредвиденная ошибка при обновлении файлов мода');
		}
	}

	async getModSlugs(): Promise<(string | null)[]> {
		const mods = await this.database.mod.findMany({ where: { isParsed: true }, select: { parsedSlug: true } });
		return mods.map(({ parsedSlug }) => parsedSlug);
	}

	async create({ translations, ...modEntity }: ModEntity): Promise<Mod> {
		try {
			return await this.database.mod.create({
				data: {
					...modEntity,
					versions: {
						connectOrCreate: modEntity.versions.map(({ version }) => ({
							where: { version },
							create: { version }
						}))
					}
				},
				include: { versions: true, _count: { select: { apps: true } } }
			});
		} catch (error) {
			console.error(error);
			throw new Error('Произошла непредвиденная ошибка при создании мода');
		}
	}

	async update(id: number, { translations, ...modEntity }: ModEntity): Promise<Mod> {
		try {
			return await this.database.mod.update({
				where: { id },
				data: {
					...modEntity,
					versions:
						modEntity.versions && modEntity.versions.length
							? {
									set: [],
									connectOrCreate: modEntity.versions.map(({ version }) => ({
										where: { version },
										create: { version }
									}))
								}
							: undefined
				},
				include: { versions: true, _count: { select: { apps: true } } }
			});
		} catch (error) {
			console.error(error);
			throw new Error('Произошла непредвиденная ошибка при редактировании мода');
		}
	}

	async findById(id: number, languageCode?: string): Promise<ModWithVersions | null> {
		return (await this.database.mod.findUnique({
			where: { id },
			omit: { htmlDescription: true },
			include: {
				versions: true,
				translations: {
					where: { language: { code: languageCode } }
				},
				_count: { select: { apps: true } }
			}
		})) as unknown as ModWithVersions;
	}

	async findBySlug(slug: string): Promise<ModWithVersions | null> {
		return this.database.mod.findUnique({
			where: { parsedSlug: slug },
			include: { versions: true, translations: true, _count: { select: { apps: true } } }
		});
	}
}
