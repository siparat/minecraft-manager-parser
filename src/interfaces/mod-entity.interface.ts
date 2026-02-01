import { Mod } from '../../generated/prisma';

export type PartialFields<Object extends object, Fields extends keyof Object> = Omit<Object, Fields> &
	Partial<Pick<Object, Fields>>;

export type IModEntity = PartialFields<
	Mod,
	| 'id'
	| 'parsedSlug'
	| 'createdAt'
	| 'updatedAt'
	| 'isParsed'
	| 'descriptionImages'
	| 'htmlDescription'
	| 'commentCounts'
	| 'rating'
>;
