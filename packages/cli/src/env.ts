/** CLI client config. Read at module load — restart CLI to apply changes. */
export const env = {
  apiUrl:
    process.env['FEEDFORGE_API_URL']?.replace(/\/$/, '') ?? 'http://localhost:3000',
  apiKey: process.env['FEEDFORGE_API_KEY'] ?? '',
};
