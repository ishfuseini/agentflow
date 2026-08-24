import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const PATH_SEPARATOR = /[/\\]/;

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			adapter: adapter(),
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(PATH_SEPARATOR).includes("node_modules")
						? undefined
						: true,
			},
		}),
	],
	ssr: {
		// @lucide/svelte ships raw .svelte components; compile them during SSR
		// instead of letting Node load the files directly.
		noExternal: ["@lucide/svelte"],
	},
});
