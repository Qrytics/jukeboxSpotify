import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
export default {
	kit: {
		paths: { relative: false },
		adapter: adapter({ runtime: 'nodejs22.x' })
	}
};
