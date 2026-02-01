import { Mod } from '../../generated/prisma';

export interface ModSearchResponse {
	count: number;
	mods: Mod[];
}
