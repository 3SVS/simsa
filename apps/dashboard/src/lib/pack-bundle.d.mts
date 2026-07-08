export type PackFile = { path: string; content: string };
export function isSecretFile(path: string): boolean;
export function filesForTextBundle<T extends PackFile>(files: T[]): T[];
export function hasSecretFiles(files: PackFile[]): boolean;
