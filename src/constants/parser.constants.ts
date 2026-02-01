export enum ParserStatus {
	STARTED = 'STARTED',
	STOPPED = 'STOPPED'
}

export const ParserErrorMessages = {
	ALREADY_STARTED: 'Парсер уже запущен',
	PARSING_SERVERS_ERROR: 'Ошибка при парсинге серверов',
	PARSING_CRAFTS_ERROR: 'Ошибка при парсинге крафтов'
};
