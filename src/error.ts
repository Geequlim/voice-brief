export function hasErrorCode(error: unknown, code: string) {
	return error instanceof Error && 'code' in error && error.code === code;
}

export function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}
