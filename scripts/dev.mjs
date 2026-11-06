// Dev loop: Vite serves the renderer, Electron loads it from there. Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // the package exports the binary path

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5173/';

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_URL: url } });
const stop = async () => {
	child.kill();
	await server.close();
	process.exit(0);
};
child.on('exit', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
