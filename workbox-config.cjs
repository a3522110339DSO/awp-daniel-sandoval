// workbox-config.js
module.exports = {
	// La carpeta que Workbox analizará para cachear archivos.
	// Para Vite, esta es siempre la carpeta 'dist'.
	globDirectory: 'dist/',

	// Los tipos de archivos que se incluirán en el caché.
	globPatterns: [
		'**/*.{js,css,html,ico,png,svg,webp,json}'
	],

	// El nombre y la ubicación del archivo del Service Worker que se generará.
	swDest: 'dist/sw.js',

	// Reglas para ignorar ciertos parámetros en las URLs al cachear.
	ignoreURLParametersMatching: [
		/^utm_/,
		/^fbclid$/
	]
};